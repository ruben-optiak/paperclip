#!/usr/bin/env python3
"""Bounded public SEO observation and offline analysis; Python standard library only."""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET


PACKAGE = Path(__file__).resolve().parents[2]
PRIVATE_PATH = re.compile(r"/(wp-admin|wp-json|wp-login\.php|cart|checkout|my-account|carrito|finalizar-compra|mi-cuenta|order-pay|order-received)(/|$)", re.I)


def safe_url(value, origin, base=None):
    """Keep URL identity (including trailing slash); reject action/query/private URLs."""
    try:
        url = urlsplit(urljoin(base or origin + "/", value))
        root = urlsplit(origin)
        decoded = unquote(url.path)
        if (url.scheme != "https" or url.netloc != root.netloc or url.username or
                url.password or url.query or "?" in decoded or "#" in decoded or
                "@" in decoded or "\\" in decoded or any(ord(c) < 32 for c in decoded) or
                PRIVATE_PATH.search(decoded) or re.search(r"\b\d{9,}\b", decoded)):
            return None
        return f"https://{url.netloc}{url.path or '/'}"
    except (ValueError, TypeError):
        return None


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config.get("schema") != "enki-seo-pipeline-config/v1":
        raise ValueError("Unsupported config schema")
    origin = config["origin"]
    if safe_url(origin, origin) != origin + "/" or urlsplit(origin).path:
        raise ValueError("Expected a clean HTTPS origin")
    caps = {"sitemaps": 30, "inventoryUrls": 10000, "pages": 150, "perSitemap": 30,
            "requestTimeoutSeconds": 30, "bodyBytes": 5000000, "redirects": 6}
    for key, cap in caps.items():
        value = config["limits"][key]
        if not isinstance(value, int) or not 1 <= value <= cap:
            raise ValueError(f"Invalid limit: {key}")
    if not 0.1 <= config["limits"]["delaySeconds"] <= 5:
        raise ValueError("Invalid request delay")
    if any(safe_url(seed, origin) is None for seed in config["seeds"]):
        raise ValueError("Unsafe seed")
    periods = config.get("periods", [])
    if len(periods) != 2:
        raise ValueError("Exactly two comparison periods are required")
    prior_end = None
    for period in periods:
        start, end = period["start"], period["end"]
        if not all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) for value in (start, end)):
            raise ValueError("Expected calendar date labels")
        first, last = datetime.fromisoformat(start), datetime.fromisoformat(end)
        if first > last or prior_end is not None and first <= prior_end:
            raise ValueError("Comparison periods must be ordered and nonoverlapping")
        prior_end = last
    return config


def robots_groups(text):
    groups, agents, rules = [], [], []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = [part.strip() for part in line.split(":", 1)]
        key = key.lower()
        if key == "user-agent":
            if rules:
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(value.lower())
        elif key in ("allow", "disallow") and agents and value:
            rules.append((key == "allow", value))
    if agents:
        groups.append((agents, rules))
    return groups


def robots_allowed(text, url, agent):
    candidates = []
    for agents, rules in robots_groups(text):
        specificity = max((len(a) if a != "*" else 0 for a in agents
                           if a == "*" or a in agent.lower()), default=-1)
        if specificity >= 0:
            candidates.append((specificity, rules))
    best = max((item[0] for item in candidates), default=-1)
    matches = []
    for specificity, rules in candidates:
        if specificity != best:
            continue
        for allowed, pattern in rules:
            expression = re.escape(pattern).replace(r"\*", ".*")
            if expression.endswith(r"\$"):
                expression = expression[:-2] + "$"
            if re.search("^" + expression, urlsplit(url).path):
                matches.append((len(pattern.replace("*", "").rstrip("$")), allowed))
    return max(matches, default=(0, True))[1]


def sitemap_entries(xml):
    if re.search(r"<!DOCTYPE|<!ENTITY", xml, re.I):
        raise ValueError("XML entities are not permitted")
    root = ET.fromstring(xml)
    tag = root.tag.rsplit("}", 1)[-1]
    if tag not in ("urlset", "sitemapindex"):
        raise ValueError("Not a sitemap")
    item_tag = "url" if tag == "urlset" else "sitemap"
    # Direct children only: image:loc is not a page URL.
    entries = []
    for item in root:
        if item.tag.rsplit("}", 1)[-1] != item_tag:
            continue
        for child in item:
            if child.tag.rsplit("}", 1)[-1] == "loc" and child.text:
                entries.append(child.text.strip())
                break
    return tag, entries


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals, self.links, self.robots, self.title = [], [], [], []
        self.h1_count = self.description_length = self.words = 0
        self.hidden = 0
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self.hidden += 1
        if self.hidden:
            return
        if tag == "title":
            self.in_title = True
        if tag == "h1":
            self.h1_count += 1
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonicals.append(attrs.get("href") or "")
        if tag == "meta":
            name = (attrs.get("name") or "").lower()
            content = attrs.get("content") or ""
            if name in ("robots", "googlebot"):
                self.robots.append(content)
            if name == "description":
                self.description_length = len(content.strip())
        if tag == "a" and attrs.get("href"):
            self.links.append((attrs["href"], "nofollow" in (attrs.get("rel") or "").lower().split()))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.hidden:
            return
        if self.in_title:
            self.title.append(data)
        self.words += len(data.split())


def inspect_page(html, url, origin, headers=None):
    parser = PageParser()
    parser.feed(html)
    title = " ".join(" ".join(parser.title).split())
    directives = ",".join(parser.robots + [(headers or {}).get("x-robots-tag", "")]).lower()
    canonicals = [safe_url(value, origin, url) for value in parser.canonicals]
    outgoing = sorted({target for raw, nofollow in parser.links
                       if not nofollow and (target := safe_url(raw, origin, url))})
    return {
        "titleLength": len(title),
        "titleSha256": hashlib.sha256(title.encode()).hexdigest() if title else None,
        "descriptionLength": parser.description_length, "h1Count": parser.h1_count,
        "documentWordCount": parser.words,
        "noindex": bool(re.search(r"\b(noindex|none)\b", directives)),
        "nofollow": bool(re.search(r"\b(nofollow|none)\b", directives)),
        "canonicalCount": len(canonicals),
        "canonical": canonicals[0] if len(canonicals) == 1 else None,
        "unsafeCanonicalCount": sum(value is None for value in canonicals),
        "outgoing": [] if re.search(r"\b(nofollow|none)\b", directives) else outgoing,
    }


class GuardedRedirect(HTTPRedirectHandler):
    def __init__(self, origin, agent, rules, cap):
        self.origin, self.agent, self.rules, self.cap = origin, agent, rules, cap
        self.chain = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe = safe_url(newurl, self.origin)
        if safe is None or len(self.chain) >= self.cap:
            raise ValueError("redirect_outside_scope_or_limit")
        if self.rules is not None and not robots_allowed(self.rules, safe, self.agent):
            raise ValueError("redirect_disallowed_by_robots")
        self.chain.append({"status": code, "target": safe})
        return super().redirect_request(req, fp, code, msg, headers, safe)


class Reader:
    def __init__(self, config):
        self.config, self.rules, self.requests = config, None, 0

    def get(self, url, bootstrap=False):
        config = self.config
        safe = safe_url(url, config["origin"])
        if safe is None:
            return {"url": None, "error": "unsafe_url", "status": None}, None
        if not bootstrap and (self.rules is None or not robots_allowed(self.rules, safe, config["userAgent"])):
            return {"url": safe, "error": "robots_unavailable_or_disallowed", "status": None}, None
        redirect = GuardedRedirect(config["origin"], config["userAgent"], self.rules, config["limits"]["redirects"])
        opener = build_opener(redirect)
        time.sleep(config["limits"]["delaySeconds"])
        self.requests += 1
        record = {"url": safe, "status": None, "redirects": redirect.chain}
        try:
            request = Request(safe, method="GET", headers={"User-Agent": config["userAgent"], "Accept-Encoding": "identity"})
            with opener.open(request, timeout=config["limits"]["requestTimeoutSeconds"]) as response:
                record.update(status=response.status, finalUrl=response.url)
                body = response.read(config["limits"]["bodyBytes"] + 1)
                if len(body) > config["limits"]["bodyBytes"]:
                    raise ValueError("body_limit")
                record["contentType"] = response.headers.get_content_type()
                record["bodySha256"] = hashlib.sha256(body).hexdigest()
                record["xRobotsTag"] = response.headers.get("X-Robots-Tag", "")[:200]
                return record, body.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        except HTTPError as exc:
            record.update(status=exc.code, error="http_error")
            exc.close()
        except (URLError, TimeoutError, OSError):
            record["error"] = "network_error"
        except ValueError as exc:
            record["error"] = str(exc)
        return record, None


def crawl(config, reader=None):
    reader = reader or Reader(config)
    origin = config["origin"]
    robots, text = reader.get(origin + "/robots.txt", bootstrap=True)
    if robots["status"] != 200 or text is None:
        raise ValueError("robots_unavailable; public crawl stopped")
    reader.rules = text
    queue = [url for value in re.findall(r"^sitemap:\s*(.+)$", text, re.M | re.I)
             if (url := safe_url(value.strip(), origin))]
    queue = queue or [origin + "/sitemap_index.xml"]
    inventory, maps, seen, excluded = {}, [], set(), 0
    limited = False
    while queue and len(seen) < config["limits"]["sitemaps"]:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        record, body = reader.get(url)
        if body is None:
            maps.append(record)
            continue
        try:
            kind, entries = sitemap_entries(body)
        except (ET.ParseError, ValueError):
            record["error"] = "invalid_sitemap"
            maps.append(record)
            continue
        record.update(kind=kind, entryCount=len(entries))
        maps.append(record)
        for value in entries:
            safe = safe_url(value, origin)
            if not safe:
                excluded += 1
            elif kind == "sitemapindex":
                if safe not in seen and safe not in queue:
                    queue.append(safe)
            elif len(inventory) < config["limits"]["inventoryUrls"] or safe in inventory:
                inventory.setdefault(safe, set()).add(url)
            else:
                limited = True
    selected = list(dict.fromkeys(safe_url(seed, origin) for seed in config["seeds"]))
    editorial = origin + config["editorialSitemap"]
    selected += [url for url, sources in sorted(inventory.items()) if editorial in sources and url not in selected]
    for entry in maps:
        urls = [url for url, sources in sorted(inventory.items()) if entry["url"] in sources and url not in selected]
        selected += urls[:config["limits"]["perSitemap"]]
    cap = config["limits"]["pages"]
    pages = []
    for url in selected[:cap]:
        record, body = reader.get(url)
        if body is not None and record.get("contentType") == "text/html":
            record["signals"] = inspect_page(body, record["finalUrl"], origin, {"x-robots-tag": record.pop("xRobotsTag", "")})
        else:
            record.pop("xRobotsTag", None)
        pages.append(record)
    # Only graph edges to known public inventory/sample URLs are retained.
    known = set(inventory) | set(selected[:cap])
    for page in pages:
        if "signals" in page:
            links = page["signals"]["outgoing"]
            page["signals"]["otherSafeLinkCount"] = len(set(links) - known)
            page["signals"]["outgoing"] = [url for url in links if url in known]
    for record in maps + [robots]:
        record.pop("xRobotsTag", None)
    return {
        "schema": "enki-seo-public-snapshot/v1", "capturedAt": datetime.now(timezone.utc).isoformat(),
        "origin": origin, "configVersion": config["version"], "robots": robots,
        "sitemaps": maps,
        "inventory": [{"url": url, "sitemaps": sorted(sources)} for url, sources in sorted(inventory.items())],
        "pages": pages,
        "coverage": {"inventoryComplete": not (queue or limited or any(m.get("error") for m in maps)),
                     "sampled": True, "selectedBeforeCap": len(selected), "pagesRequested": len(pages),
                     "excludedUnsafeUrls": excluded, "logicalRequests": reader.requests,
                     "allSitePagesCrawled": False, "absenceOfInboundLinkProvesOrphan": False},
        "authority": {"isObservationOnly": True, "externalMutation": False, "rawHtmlRetained": False},
    }


def source_usable(source, now, max_age=7):
    if source.get("status") != "available" or source.get("truncated") is not False:
        return False
    try:
        age = (now - datetime.fromisoformat(source["capturedAt"].replace("Z", "+00:00"))).total_seconds()
        return 0 <= age <= max_age * 86400
    except (ValueError, KeyError, TypeError):
        return False


def period_metrics(source, config, provider):
    """Validate exact closed date labels, retain source timezone, never join sessions."""
    periods = source.get("periods", [])
    expected = [(p["start"], p["end"]) for p in config["periods"]]
    if [(p.get("start"), p.get("end")) for p in periods] != expected:
        raise ValueError("Source periods must exactly match the query contract")
    if provider == "gsc" and source.get("timezone") != "America/Los_Angeles":
        raise ValueError("GSC date labels use Pacific time")
    if provider == "ga4" and not source.get("timezone"):
        raise ValueError("GA4 property timezone is required")
    result = []
    for period in periods:
        rows = period["rows"]
        if any(safe_url(row.get("url"), config["origin"]) != row.get("url") or
               row.get("url") is None for row in rows):
            raise ValueError("Source row must use a safe public URL")
        if len({row["url"] for row in rows}) != len(rows):
            raise ValueError("Duplicate page rows; fix pagination before analysis")
        if provider == "gsc":
            metrics = gsc_aggregate(rows)
        else:
            if any(not isinstance(row.get("pageViews"), int) or row["pageViews"] < 0 for row in rows):
                raise ValueError("GA4 page views must be nonnegative integers")
            metrics = {"pageViews": sum(row["pageViews"] for row in rows), "usability": "directional"}
        result.append({"start": period["start"], "end": period["end"], "timezone": source["timezone"],
                       "returnedPages": len(rows), **metrics})
    return result


def gsc_aggregate(rows):
    for row in rows:
        if any(not isinstance(row.get(key), (float, int)) or not math.isfinite(row[key]) or row[key] < 0
               for key in ("clicks", "impressions", "position")) or row["clicks"] > row["impressions"]:
            raise ValueError("Invalid GSC metrics")
    clicks = sum(row["clicks"] for row in rows)
    impressions = sum(row["impressions"] for row in rows)
    return {"clicks": clicks, "impressions": impressions,
            "ctr": clicks / impressions if impressions else None,
            "position": sum(row["position"] * row["impressions"] for row in rows) / impressions if impressions else None}


def overlap_candidates(rows, minimum=10):
    groups = {}
    for row in rows:
        key = row.get("querySha256", "")
        if not re.fullmatch(r"[0-9a-f]{64}", key) or "query" in row:
            raise ValueError("Only query digests may enter the retained overlap input")
        groups.setdefault(key, []).append(row)
    candidates = []
    for key, group in sorted(groups.items()):
        by_url = {}
        for row in group:
            by_url.setdefault(row["url"], []).append(row)
        pages = [{"url": url, **gsc_aggregate(values)} for url, values in sorted(by_url.items())]
        pages = [page for page in pages if page["impressions"] >= minimum]
        if len(pages) >= 2:
            candidates.append({"querySha256": key, "pages": pages, "status": "overlap_candidate", "cannibalizationProven": False})
    return candidates


def search_opportunities(source, config):
    period_metrics(source, config, "gsc")
    previous, latest = source["periods"][-2:]
    before = {row["url"]: row for row in previous["rows"]}
    def days(period):
        return (datetime.fromisoformat(period["end"]) - datetime.fromisoformat(period["start"])).days + 1
    result = []
    for row in latest["rows"]:
        prior = before.get(row["url"])
        delta = row["clicks"] / days(latest) - prior["clicks"] / days(previous) if prior else None
        if prior and delta <= -0.15:
            reason, confidence = "visibility_drop_review", 0.8
        elif row["impressions"] >= 100 and 4 <= row["position"] <= 20:
            reason, confidence = "search_intent_and_snippet_review", 0.6
        else:
            continue
        impact = 4 if row["impressions"] >= 1000 else 3 if row["impressions"] >= 500 else 2
        result.append({"url": row["url"], "reason": reason, "impact": impact, "confidence": confidence,
                       "effort": 2, "risk": "medium", "score": round(impact * confidence / 2, 3),
                       "latest": {key: row[key] for key in ("clicks", "impressions", "position")},
                       "clicksPerDayDelta": delta, "earlierRowMissing": prior is None,
                       "priorityBasis": "observed_gsc", "projectedRevenue": None, "mutationAuthorized": False,
                       "acceptance": "Review intent, indexed canonical and matched-period query evidence; any later change needs a reviewed hypothesis and a new closed-period comparison, not a guaranteed uplift."})
    return sorted(result, key=lambda item: (-item["score"], -item["latest"]["impressions"], item["url"]))


def analyze(snapshot, sources, config, now=None):
    now = now or datetime.now(timezone.utc)
    def fresh(key):
        maximum = config.get("sources", {}).get(key, {}).get("maxCaptureAgeDays", 7)
        return source_usable(sources.get(key, {}), now, maximum)
    inventory = {entry["url"] for entry in snapshot["inventory"]}
    pages = snapshot["pages"]
    inbound = {url: set() for url in inventory}
    for page in pages:
        for target in page.get("signals", {}).get("outgoing", []):
            if target in inbound and target != page.get("finalUrl", page["url"]):
                inbound[target].add(page.get("finalUrl", page["url"]))
    findings = []

    def add(code, url, impact, confidence, effort, risk, evidence, acceptance):
        findings.append({"id": hashlib.sha256(f"{code}:{url}".encode()).hexdigest()[:16],
                         "code": code, "url": url, "impact": impact, "confidence": confidence,
                         "effort": effort, "score": round(impact * confidence / effort, 3),
                         "risk": risk, "evidence": evidence, "acceptance": acceptance,
                         "priorityBasis": "technical_only", "mutationAuthorized": False})

    titles = {}
    for entry in snapshot.get("sitemaps", []):
        if entry.get("error"):
            add("sitemap_unreadable", entry["url"], 4, 1, 2, "medium",
                {"error": entry["error"], "status": entry.get("status")},
                "Review robots and sitemap scope, then verify the advertised sitemap can be read by its intended crawler.")
    for page in pages:
        url = page["url"]
        signals = page.get("signals")
        if page.get("status") is not None and not 200 <= page["status"] < 300:
            add("http_error", url, 5, 1, 2, "medium", {"status": page["status"], "inSitemap": url in inventory}, "Review intent and verify expected final status on a fresh crawl.")
        if page.get("redirects") and url in inventory:
            add("sitemap_redirect", url, 3, 1, 2, "medium", {"redirects": page["redirects"]}, "Sitemap points directly to the reviewed canonical 200 URL.")
        if not signals:
            continue
        if signals["noindex"]:
            add("sitemap_noindex" if url in inventory else "noindex_observed", url, 5 if url in inventory else 2, 1, 2, "high",
                {"inSitemap": url in inventory}, "Confirm indexing intent; retain deliberate exclusions, resolve only contradictory sitemap membership.")
        if signals["canonicalCount"] != 1 or signals["unsafeCanonicalCount"]:
            add("canonical_missing_or_ambiguous", url, 2 if signals["noindex"] else 4, 1, 2, "high",
                {"count": signals["canonicalCount"], "unsafe": signals["unsafeCanonicalCount"], "noindex": signals["noindex"]},
                "Review page intent and check one safe canonical where appropriate; a noindex page may intentionally omit it.")
        elif signals["canonical"] != page.get("finalUrl", url):
            add("canonical_other_url", url, 3, 0.8, 2, "high", {"canonical": signals["canonical"]}, "Verify target status, indexability and intended canonical relationship.")
        if signals["titleLength"] == 0 or signals["h1Count"] == 0:
            add("content_identity_missing", url, 3, 1, 2, "medium", {"titleLength": signals["titleLength"], "h1Count": signals["h1Count"]}, "Reviewed template renders a meaningful title and primary heading.")
        if not signals["noindex"] and signals["descriptionLength"] == 0:
            add("description_missing", url, 2, 0.7, 2, "low", {}, "Review search intent and supply a useful description if warranted; measure separately.")
        if signals["titleSha256"]:
            titles.setdefault(signals["titleSha256"], set()).add(page.get("finalUrl", url))
    duplicates = [sorted(urls) for urls in titles.values() if len(urls) > 1]
    for urls in duplicates:
        add("duplicate_title", urls[0], 3, 0.8, 3, "medium", {"urls": urls}, "Review distinct intent and rendered templates before changing titles.")
    for source in ("gsc", "ga4"):
        if not fresh(source):
            add("source_unavailable_" + source, None, 5, 1, 1, "low", {"status": sources.get(source, {}).get("status", "missing")}, "Operator restores read access and captures a fresh closed-period snapshot.")
    latest = sources.get("gsc", {})
    usable = fresh("gsc")
    traffic = period_metrics(latest, config, "gsc") if usable else None
    ga4 = sources.get("ga4", {})
    engagement = period_metrics(ga4, config, "ga4") if fresh("ga4") else None
    overlap = sources.get("gscOverlap", {})
    overlaps = None
    # A bounded, fresh subset can suggest review candidates, never prove absence
    # of overlap or complete query coverage. Metrics still require source_usable.
    partial_overlap = (sources.get("schema") == "enki-seo-source-capture/v1" and
                       overlap.get("status") == "partial" and
                       source_usable({**overlap, "status": "available"}, now))
    if fresh("gscOverlap") or partial_overlap:
        if overlap.get("period") != config["periods"][-1] or overlap.get("timezone") != "America/Los_Angeles":
            raise ValueError("Overlap must match the latest GSC period and timezone")
        if any(safe_url(row.get("url"), config["origin"]) != row.get("url") or row.get("url") is None for row in overlap["rows"]):
            raise ValueError("Unsafe overlap URL")
        overlaps = overlap_candidates(overlap["rows"])
        if partial_overlap:
            for candidate in overlaps:
                candidate["sourceCoverage"] = "partial_observed_subset_only"
    findings.sort(key=lambda item: (-item["score"], item["code"], item["url"] or ""))
    result = {"schema": "enki-seo-analysis/v1", "analyzedAt": now.isoformat(),
            "snapshotCapturedAt": snapshot["capturedAt"], "origin": config["origin"],
            "status": "partial" if not usable or not fresh("ga4") else "technical_and_search_observation",
            "coverage": snapshot["coverage"], "inventoryUrls": len(inventory),
            "checkedPages": len(pages), "findings": findings, "traffic": traffic, "engagement": engagement,
            "searchOpportunities": search_opportunities(latest, config) if usable else None,
            "queryOverlapCandidates": overlaps, "cannibalizationProven": False,
            "internalLinks": {"scope": "sample_only", "sampleSources": len(pages),
                              "inventoryWithoutObservedInbound": sum(not values for values in inbound.values()),
                              "orphansConfirmed": None},
            "authority": {"externalMutation": False, "editorialDraft": False}}
    if sources.get("schema") == "enki-seo-source-capture/v1":
        views = {row["url"]: row["pageViews"] for row in ga4["periods"][-1]["rows"]} if fresh("ga4") else {}
        result["captureScope"] = sources["scope"]
        result["queryOverlapCoverage"] = {"status": overlap.get("status"),
            "omittedTruncatedQueryCells": overlap.get("queryCellsOmittedAsTruncated"),
            "exhaustive": False, "absenceOfCandidateProvesNoOverlap": False}
        for key in ("inspection", "sitemaps"):
            source = sources.get(key, {})
            current = source_usable({**source, "truncated": False}, now)
            result[key] = source if current else {"status": "unavailable_or_partial_or_stale", "rows": None}
        indexed = {row["url"]: row for row in result["inspection"].get("rows") or []}
        for opportunity in result["searchOpportunities"] or []:
            url = opportunity["url"]
            opportunity["ga4PageViewsDirectional"] = views.get(url)
            observation = indexed.get(url)
            opportunity["googleIndexVerdict"] = observation.get("verdict") if observation else None
            opportunity["googleCanonical"] = observation.get("googleCanonical") if observation else None
    return result


def write_new(path, value):
    with Path(path).open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["crawl", "analyze"])
    parser.add_argument("--config", default=str(PACKAGE / "references/seo/pipeline-v1.json"))
    parser.add_argument("--snapshot")
    parser.add_argument("--sources")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if Path(args.output).exists():
        parser.error("Output already exists; snapshots are immutable")
    config = load_config(args.config)
    if args.command == "crawl":
        result = crawl(config)
    else:
        if not args.snapshot or not args.sources:
            parser.error("analyze requires --snapshot and --sources")
        snapshot_bytes = Path(args.snapshot).read_bytes()
        sources = json.loads(Path(args.sources).read_text())
        if sources.get("schema") == "enki-seo-source-capture/v1" and sources.get("scope", {}).get("publicSnapshotSha256") != hashlib.sha256(snapshot_bytes).hexdigest():
            parser.error("Source capture belongs to a different public snapshot")
        result = analyze(json.loads(snapshot_bytes), sources, config)
    write_new(args.output, result)
    print(json.dumps({"schema": result["schema"], "status": result.get("status", "captured"),
                      "pages": len(result.get("pages", [])), "findings": len(result.get("findings", []))}))


if __name__ == "__main__":
    main()
