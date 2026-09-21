FROM hashicorp/terraform:1.13.3@sha256:dfb1889a8ee74ada3ddacc48f89b8a0d69f3e114de3d8a2ce15f6a8d3dbfdbe2 AS terraform
FROM ghcr.io/astral-sh/uv:0.8.17@sha256:e4644cb5bd56fdc2c5ea3ee0525d9d21eed1603bccd6a21f887a938be7e85be1 AS uv
FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git make \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.33.0

COPY --from=terraform /bin/terraform /usr/local/bin/terraform
COPY --from=uv /uv /uvx /usr/local/bin/
COPY connectors/qa-source-runner/src/runner.mjs /opt/optiak-qa/runner.mjs
COPY skills/optiak-e2e-validation/references/qa-source-execution-contract.json /opt/optiak-qa/qa-source-execution-contract.json

ENV QA_CONTRACT_PATH=/opt/optiak-qa/qa-source-execution-contract.json
USER 65532:65532
ENTRYPOINT ["node", "/opt/optiak-qa/runner.mjs"]
