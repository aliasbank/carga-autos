# Despliegue en Ubuntu con Docker

Esta entrega ejecuta la aplicación como un contenedor y conserva usuarios, cargadores, turnos y sesiones en el volumen Docker `carga_en_orden_data`. El volumen no se elimina al actualizar ni al ejecutar `docker compose down` sin `-v`.

## Requisitos

- Ubuntu con Docker Engine y el complemento Docker Compose.
- Un DNS y un proxy HTTPS (Nginx o Caddy) si el sistema será accesible fuera de la red interna.

## Inicio rápido

1. Copia el proyecto al servidor y entra a la carpeta:

   ```bash
   cd cargadores-turnos
   ```

2. Crea la configuración local y genera el secreto interno de automatización:

   ```bash
   cp .env.docker.example .env
   openssl rand -hex 32
   ```

   Copia el valor generado en `QUEUE_AUTOMATION_TOKEN` dentro de `.env`.
   Este valor debe tener 64 caracteres hexadecimales. Si ya tenías un archivo
   `.env`, conserva sus valores y agrega únicamente esa variable.

3. Construye e inicia el servicio:

   ```bash
   docker compose up -d --build
   ```

4. Comprueba su estado:

   ```bash
   docker compose ps
docker compose logs -f cargadores
```

El primer arranque ejecuta un contenedor breve que prepara los permisos del volumen; después la aplicación corre con el usuario sin privilegios `node`. La aplicación queda disponible solo en `127.0.0.1:8787` de forma predeterminada. Esto permite colocar Nginx o Caddy al frente para TLS y control de acceso. Para una prueba temporal desde la red interna, cambia `APP_BIND_ADDRESS` a `0.0.0.0` en `.env` y reinicia con `docker compose up -d`.

También se inicia el servicio interno `queue-automation`. No expone puertos y
revisa la fila cada 30 segundos. Puedes revisar sus registros con:

```bash
docker compose logs -f queue-automation
```

## Ausencias en la fila

Cuando un usuario queda como siguiente persona y el cargador ya está disponible,
tiene 10 minutos para marcar **Conectado**. Si no lo hace, el sistema cancela ese
turno y crea uno nuevo al final de la fila del mismo cargador. Las personas que
estaban detrás avanzan inmediatamente; no se reserva un nuevo margen de transición
porque el cargador ya está libre.

La revisión ocurre aun cuando ningún usuario tenga abierta la aplicación. La
aplicación también revisa esta regla al cargar el tablero o realizar una acción,
como protección adicional.

## Datos y migraciones

Al arrancar, el contenedor aplica únicamente las migraciones pendientes antes de abrir el servicio. La base D1 local y el registro de migraciones se guardan en el volumen Docker; por ello, reiniciar o reconstruir el contenedor no borra los datos.

No uses `docker compose down -v` salvo que desees eliminar definitivamente todos los datos.

## Actualización

Sustituye los archivos del proyecto y ejecuta:

```bash
docker compose up -d --build
```

Las nuevas migraciones se aplicarán una sola vez al iniciar.

## Respaldo

Antes de actualizar una versión importante, crea una copia del volumen:

```bash
mkdir -p backups
docker run --rm \
  -v carga-en-orden_carga_en_orden_data:/data:ro \
  -v "$(pwd)/backups:/backup" \
  alpine:3.21 sh -c 'tar czf /backup/carga-en-orden-$(date +%F).tgz -C / data'
```

Guarda el archivo generado fuera del servidor para disponer de una recuperación real.

## Operación segura

- Mantén el puerto del contenedor en `127.0.0.1` y publica únicamente el proxy HTTPS.
- No ejecutes la aplicación como root: el contenedor usa el usuario `node` y elimina capacidades Linux innecesarias.
- No publiques ni compartas `QUEUE_AUTOMATION_TOKEN`; el archivo `.env` debe permanecer fuera de Git.
- Restringe SSH, aplica actualizaciones de seguridad de Ubuntu y conserva respaldos periódicos del volumen.
