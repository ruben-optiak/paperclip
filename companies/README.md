# Trabajo con varias compañías

Esta carpeta contiene los paquetes privados y versionados de las compañías que
se ejecutan sobre Paperclip. Paperclip sigue siendo el producto base; cada
compañía mantiene aquí sus agentes, skills, conectores, políticas, fixtures y
runbooks sin mezclar sus dominios.

Paquetes:

- `companies/enki-hogar-ai-os/`: Enki Hogar.
- `companies/optiak-ai-os/`: Optiak, pendiente de crear.

Las credenciales, los `.env` reales, la base de datos y el estado de cada
instancia no se guardan en Git.

## Modelo de ramas

```text
upstream/master
      │
      ▼
master                         espejo limpio del Paperclip original
      │
      ▼
sync/upstream-YYYY-MM-DD       integración y validación de una actualización
      │
      ▼
integration/companies          versión desplegable con todas las compañías
      │
      ├── feat/enki/nombre-tarea
      └── feat/optiak/nombre-tarea
```

| Rama | Uso | Regla |
| --- | --- | --- |
| `master` | Espejo de `upstream/master` | No desarrollar ni añadir paquetes de compañías aquí. |
| `integration/companies` | Paperclip actualizado más todos los paquetes privados | Es la base para trabajar, probar e importar/desplegar. No desarrollar directamente aquí. |
| `feat/enki/*` | Cambios exclusivos de Enki | Crear desde `integration/companies` y fusionar de vuelta cuando estén verificados. |
| `feat/optiak/*` | Cambios exclusivos de Optiak | Crear desde `integration/companies` y fusionar de vuelta cuando estén verificados. |
| `sync/upstream-YYYY-MM-DD` | Resolver y probar una actualización de Paperclip | Crear desde `integration/companies`; nunca mezclar upstream directamente en una rama de compañía. |

`feat/enki-hogar-approach` se conserva como checkpoint histórico del primer
setup de Enki. El trabajo nuevo debe usar ramas cortas como `feat/enki/EAI-022`
o `feat/enki/catalogo-radiadores`.

## Comandos cotidianos

### Saber dónde estoy

```sh
git status --short --branch
git branch --show-current
git log -5 --oneline --decorate
```

### Actualizar la base común

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
```

### Empezar una tarea de Enki

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
git switch -c feat/enki/EAI-022
```

### Empezar el setup de Optiak

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
git switch -c feat/optiak/bootstrap
```

### Guardar y subir trabajo

Revisar primero qué se va a guardar:

```sh
git status --short
git diff
```

Añadir solo los archivos de la tarea, crear el commit y subir la rama:

```sh
git add companies/optiak-ai-os
git commit -m "feat(optiak): bootstrap company package"
git push -u origin feat/optiak/bootstrap
```

Para Enki, sustituir la ruta y el mensaje por los de la tarea de Enki. Evitar
`git add .` cuando haya cambios no relacionados en el repositorio.

### Traer cambios recientes de la integración a una tarea

Este flujo usa `merge` para evitar reescribir una rama que ya se haya subido:

```sh
git fetch origin
git switch feat/optiak/bootstrap
git merge origin/integration/companies
```

Resolver los conflictos, ejecutar las pruebas del paquete y subir el resultado:

```sh
git status --short
git add ruta-del-archivo-resuelto
git commit
git push
```

### Integrar una tarea terminada

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
git merge --no-ff feat/optiak/bootstrap
git push origin integration/companies
```

Antes del `push`, ejecutar el validador, el escaneo de secretos y las pruebas
del paquete afectado. Para Enki:

```sh
./companies/enki-hogar-ai-os/scripts/check.sh
```

La importación en la UI o el despliegue son pasos separados: fusionar una rama
no modifica automáticamente ninguna compañía ni base de datos de Paperclip.

## Trabajar con Enki y Optiak a la vez

Un único checkout solo puede tener una rama activa. `git worktree` permite abrir
cada compañía en una carpeta independiente, compartiendo el mismo repositorio
y sin hacer `stash` constantemente.

Desde el checkout principal:

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
git worktree add ../paperclip-enki -b feat/enki/nombre-tarea integration/companies
git worktree add ../paperclip-optiak -b feat/optiak/bootstrap integration/companies
git worktree list
```

Después se puede trabajar en paralelo:

```sh
cd ../paperclip-enki
git status --short --branch
```

```sh
cd ../paperclip-optiak
git status --short --branch
```

Cuando una rama esté fusionada, su carpeta esté limpia y ya no sea necesaria:

```sh
git worktree remove ../paperclip-optiak
git branch -d feat/optiak/bootstrap
```

No usar `--force` para quitar un worktree con cambios pendientes.

### Ejecutar Paperclip desde varios worktrees

Un worktree separa archivos y ramas, pero no separa automáticamente la base de
datos. Si se levanta un servidor Paperclip desde más de un worktree, inicializar
una instancia aislada dentro de cada uno antes de ejecutar `pnpm dev`:

```sh
cd ../paperclip-optiak
npx paperclipai worktree init
pnpm dev
```

Esto no es necesario para usar Enki y Optiak como dos compañías distintas en
una única instancia Docker: Paperclip ya aplica el aislamiento por compañía.

## Sincronizar con el Paperclip original

El remoto `upstream` apunta a `paperclipai/paperclip`; `origin` es el fork. Hacer
la sincronización con el checkout limpio y sin trabajo de compañía pendiente.

### 1. Actualizar el espejo

```sh
git fetch upstream
git switch master
git merge --ff-only upstream/master
git push origin master
```

Si `master` no puede avanzar con `--ff-only`, detenerse: contiene un cambio que
no pertenece al espejo y debe investigarse, no resolverse con un merge casual.

### 2. Crear una rama de sincronización

Sustituir la fecha del ejemplo por la fecha actual:

```sh
git switch integration/companies
git pull --ff-only origin integration/companies
git switch -c sync/upstream-2026-09-15
git merge --no-ff master
```

Resolver conflictos con contexto, especialmente en portabilidad, autenticación,
permisos, conectores y tests. No elegir automáticamente `ours` o `theirs` para
todo el árbol.

### 3. Validar e integrar

Ejecutar primero las pruebas afectadas, después los checks de las compañías y,
si el entorno tiene todo el toolchain, los checks generales de Paperclip.

```sh
pnpm install --frozen-lockfile
./companies/enki-hogar-ai-os/scripts/check.sh
pnpm -r typecheck
pnpm test
pnpm build
```

Cuando esté validado:

```sh
git push -u origin sync/upstream-2026-09-15
git switch integration/companies
git merge --ff-only sync/upstream-2026-09-15
git push origin integration/companies
```

La rama de sincronización se puede conservar temporalmente como evidencia del
merge. Las ramas activas de Enki y Optiak recibirán después la nueva base con:

```sh
git fetch origin
git merge origin/integration/companies
```

## Reglas de seguridad

- No trabajar directamente en `master` ni en `integration/companies`.
- No hacer `push --force` sobre ramas compartidas.
- No usar `git reset --hard` para resolver una sincronización.
- No mezclar en un commit cambios de Enki, Optiak y core sin una razón explícita.
- No añadir `.env`, credenciales, tokens, PII o exports de bases de datos.
- Hacer backup de la instancia antes de una importación o promoción relevante.
- Mantener agentes y rutinas nuevos pausados hasta superar el smoke test.

## Chuleta rápida

```sh
git status --short --branch              # estado y rama actual
git switch integration/companies         # volver a la base común
git switch -                             # volver a la rama anterior
git fetch --all --prune                  # actualizar referencias remotas
git branch -vv                           # ramas y tracking remoto
git log --graph --oneline --decorate --all -20
git diff                                 # cambios sin preparar
git diff --staged                        # cambios preparados para commit
git worktree list                        # carpetas y ramas abiertas
```
