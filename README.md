# aquí & allá ♥

Un rinconcito para jugar en pareja a distancia: sala de espera, chat, reacciones,
zumbidos, música tranquila y minijuegos.

**Jugar:** https://elrobamichis.github.io/aqui-y-alla/ — uno abre una sala y le manda el
enlace (o el código de 6 letras) a su persona.

## Cómo funciona sin servidor

La página vive en GitHub Pages (solo archivos) y es gratis. Para que los dos teléfonos se
hablen se usa un **repetidor MQTT público** (`test.mosquitto.org`, y `broker.hivemq.com` de
respaldo): cada navegador se conecta por WebSocket y se mandan mensajes por "temas" de la sala.

- **Todo va cifrado** (AES-GCM). La clave sale del código de la sala con PBKDF2, así que el
  repetidor solo ve bytes sin sentido y ni el nombre de los temas revela el código.
- **Uno de los dos navegadores hace de árbitro** (el "líder"): corre `room-core.js`, que es
  la lógica que antes estaba en el servidor (chat, presencia, invitaciones, reglas de los
  juegos). El otro le manda sus jugadas por el repetidor.
- **El estado de la sala se guarda cifrado en el repetidor** (mensaje retenido) y una copia
  en el teléfono. Si el líder cierra la página, se queda sin señal o cambia de app, el otro
  toma el estado guardado y sigue de árbitro sin que se note.
- La presencia ("en línea") usa el "testamento" de MQTT: si un teléfono desaparece sin
  avisar, el repetidor lo anuncia solo.

- **Conexión directa en las partidas** (`rtc.js`, WebRTC): con un juego abierto y los dos
  a la vista, los teléfonos intentan hablarse directo (sin pasar por Europa): la puntería y
  los pings van solo por ahí, y lo importante (jugadas, chat) va por los dos caminos a la vez
  con número de secuencia, así que si lo directo se corta no se pierde ni se repite nada. Se
  presentan por el repetidor (cifrado) con servidores STUN públicos; si la red no lo permite
  (algunas celulares), todo sigue por el repetidor. ⚡ junto a los ms = conexión directa.
  En el menú, "Probar mi conexión" dice si la red del teléfono la permite.

Los repetidores públicos son gratuitos y sin garantías. Si uno no responde, la app prueba el
siguiente; los dos teléfonos usan el mismo orden.

## Diseñado para datos móviles

- **~50 KB** la primera vez (comprimido; ~65 KB con el motor del billar). Después el navegador lo guarda en caché. Sin fuentes, imágenes ni audio descargado: los
  personajes son SVG hechos con código y la música/efectos se sintetizan en el navegador.
- **Se guarda en el teléfono** (service worker): después de la primera visita abre al instante
  sin descargar nada, y cada versión nueva se baja una sola vez.
- **Mensajes binarios diminutos**: un mensaje de chat son ~100 bytes cifrados y un tiro de billar
  algo parecido. El estado de la sala solo se sube cuando cambia (comprimido, juntando varios
  cambios; los "visto" esperan a lo siguiente) y el invitado no lo descarga.
- **La puntería en vivo se adapta a la señal**: con buena señal se ve fluida; con señal mala se
  manda menos seguido y con señal pésima se apaga (el otro solo ve el tiro).
- **Tirar sin señal**: el tiro se juega en tu pantalla, se queda en cola y se manda solo al
  volver la conexión (como el chat). Los tiempos de espera crecen con la latencia medida, así
  que una conexión lenta (3G, una rayita) no se corta por impaciente.
- **Aguanta cambios de red** (wifi ⇄ datos): reconexión inmediata, detección de conexiones
  "zombis", reanudación con token y solo se pide el historial que falta. Los mensajes que se
  mandan sin señal quedan en cola y se reenvían sin duplicarse.

## Juegos

- **Gato** (`public/js/games/`): modo **Clásico** y modo **Infinito** (cada quien tiene
  máximo 3 fichas; al poner la cuarta se borra la más vieja, que se ve tenue antes;
  nunca hay empate). Invitación con elección de modo, revancha (empieza el otro),
  marcador guardado y cambio de modo entre rondas.
- **Billar** (bola 8): física realista en `billar-physics.js` (escrita con Fable 5.2):
  la bola desliza y luego rueda, el efecto arriba/abajo produce corrido y retroceso,
  el efecto lateral cambia el rebote en banda y desvía un poco la blanca (squirt),
  hay "throw" entre bolas y troneras con labios donde la bola puede rebotar.
  La simulación es determinista (sin `sin`/`cos`/`exp`), así que el líder la usa
  como árbitro y los dos navegadores animan exactamente el mismo tiro: por la red
  solo viaja el tiro (fuerza, dirección y punto de golpe). La puntería del otro se ve
  en vivo. En celular hay modo "mesa grande" y acomodos para vertical y horizontal.
- Las reglas (`*-rules.js`) las usan **el líder como árbitro** y cada navegador para
  mostrar tu jugada al instante. Cada jugada lleva la versión del estado: jugadas
  repetidas o atrasadas se rechazan, y tras un corte se recupera la partida tal cual.
- Cada juego se descarga solo cuando se juega.

## Correrlo en tu compu

```bash
npm start          # http://localhost:3000 (solo sirve los archivos; usa el mismo repetidor)
npm test           # física + reglas del billar + lógica de sala
```

Para probar a las dos personas en el mismo navegador, abre una segunda pestaña con
`?as=b` (ej. `http://localhost:3000/?as=b`): usa un almacenamiento separado.
`?broker=wss://…` agrega otro repetidor MQTT al principio de la lista.

Cada `git push` a `main` corre las pruebas y publica `public/` en GitHub Pages
(`.github/workflows/pages.yml`).

## Estructura

```
public/index.html       shell + iconos SVG
public/css/style.css    estilo papelería: papel, timbres, tinta
public/js/app.js        interfaz: lobby, sala, chat, reacciones, juegos
public/js/net.js        conexión al repetidor, cifrado, elección de líder, reintentos
public/js/mqtt.js       cliente MQTT mínimo (~3 KB)
public/js/rtc.js        conexión directa entre teléfonos (WebRTC) y prueba de red
public/js/room-core.js  lógica de la sala (la corre el líder)
public/js/audio.js      música generativa lo-fi y efectos, todo sintetizado
public/js/critters.js   personajes (ajolote, gato, conejo, osito, rana)
public/js/games/        gato y billar (reglas, física e interfaz)
server.js               servidor de archivos para desarrollo
test/                   pruebas
```
