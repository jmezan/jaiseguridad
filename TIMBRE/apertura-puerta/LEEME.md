# Apertura de puerta del portero (relé Tuya)

## 1. Tuya: conseguir las claves (una sola vez)
1. Entrá a https://iot.tuya.com con una cuenta nueva o la tuya.
2. Cloud → Development → **Create Cloud Project**.
   - Industry / Development Method: **Smart Home**.
   - Data Center: el mismo de tu app Tuya. Para Argentina normalmente es **Western America**.
3. En el proyecto, pestaña **Overview**: copiá **Access ID/Client ID** y **Access Secret/Client Secret**.
4. Pestaña **Devices → Link App Account → Add App Account**: escaneá el QR con la app Tuya
   (Yo / Me → ícono de escanear arriba a la derecha).
5. En la lista de dispositivos aparece el relé: copiá su **Device ID**.
6. Pestaña **Service API**: verificá que esté autorizado **IoT Core**. El plan de prueba de Tuya
   se renueva gratis cada cierto tiempo desde esa misma consola.

## 2. Supabase: tablas
SQL Editor → pegá `puerta-setup.sql` → **Run**.

## 3. Supabase: función
1. Edge Functions → **Deploy a new function → Via Editor**.
2. Nombre: `puerta`. Pegá el contenido de `index.ts` y tocá **Deploy**.
3. En la configuración de la función, **desactivá "Verify JWT"** (Enforce JWT verification).
4. Edge Functions → **Secrets** → agregá:
   - `TUYA_CLIENT_ID`  = Access ID
   - `TUYA_SECRET`     = Access Secret
   - `TUYA_ENDPOINT`   = `https://openapi.tuyaus.com` (Western America)
   - `PUERTA_ADMIN_KEY` = una clave larga inventada por vos (la usás en el panel)
   - Solo si la función responde "Error del servidor": `PUERTA_DB_KEY` = tu clave secreta `sb_secret_…`
     (Project Settings → API Keys).

## 4. Panel del portero
1. Subí `edificio.html` al repo TIMBRE-API.
2. Panel → edificio → **Apertura de puerta** → pegá la clave de administrador → Conectar.
3. Pegá el **Device ID**, dejá el canal en `switch_1` y 1 segundo → **Guardar equipo** → **Probar apertura**.
4. En cada departamento, **🔑 PIN puerta** → cargá un PIN y pasáselo al vecino en privado.

## Seguridad
- Las claves de Tuya y los PINs viven solo en Supabase (los PINs con hash).
- 5 PINs equivocados seguidos bloquean ese departamento 15 minutos; 20 en el edificio, todo el edificio.
- Cada apertura e intento queda registrado (se ve en el panel).
