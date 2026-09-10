# cuaderno-campo

Cuaderno de campo y lector de cámara de forzado para colecciones de frutales. Una PWA sin servidor que se abre en el móvil, funciona sin cobertura, y entra y sale de Excel.

**Estado: entrega E1 en pruebas (muestreo y lectura de cámara) y pantalla Parcela en construcción (E2, floración por árbol sobre los planos del grupo).** La app se instala desde [danielgp121.github.io/cuaderno-campo](https://danielgp121.github.io/cuaderno-campo/) y funciona sin cobertura. El motor reproduce la campaña de forzado 2025-2026 del EEAD: los 50 requerimientos de frío (CP50) y los 43 descensos de curva salen idénticos al pipeline de R, y el Excel que exporta la app, releído, da los mismos números. Primer uso previsto: los muestreos de salida de letargo de noviembre de 2026. Después, fenología floral en campo (febrero de 2027) y censo de estado (septiembre de 2027). El censo ya existe como herramienta independiente en [croquis-campo](https://github.com/DanielGP121/croquis-campo), que esta app absorbe.

## Cómo se usa

1. **Inicio.** Pon un nombre al dispositivo (queda en cada dato). Carga los planos de parcela (el Excel con una hoja por parcela dibujada) y, como historial, el listado de floración de la campaña anterior; para el forzado, el registro de árboles desde el Excel `Peach_Sampling` (hoja `Sampling`) y el cuaderno de forzado de otra campaña. Cargar dos veces el mismo fichero no duplica nada. Sin ficheros a mano, el botón de colección de ejemplo crea una parcela de doce árboles inventados con dos visitas de 2026. Abajo hay un cuadro de sugerencias que viaja con la copia de seguridad.
2. **Parcela.** Elige la parcela y la fecha de la visita (marca "vuelo de dron" el día que vuela). El mapa dibuja cada fila como en el plano, con el color del estado de hoy; las pestañas de fila dicen cuántos árboles faltan. En la lista de la fila, un toque abre el árbol: letras previas (B a E), porcentaje de flores abiertas y de pétalos caídos, y la etiqueta sale escrita como en las hojas (`DE-F1`, `F95-C10`). Guardar salta al siguiente sin hacer; "Deshacer la última" retira el último dato. En el mismo panel van los descriptores UPOV (densidad de botones, tipo de flor, pétalos), el estado del árbol (baja, dudosa) y las visitas anteriores. Los eventos del día (poda, tratamiento, helada, riego) salen luego como columnas del Excel. La app no estima: lo que venga en rojo de un Excel se conserva en rojo.
3. **Muestreo.** "Nuevo muestreo" numera el siguiente, elige completo (todas las referencias) o tempranas, fecha y CP acumuladas. La lista sale en orden de recorrido por hileras, con los códigos de tubo de cada árbol (`3_7_A`, `3_7_B`, `3_7_C`). Cada árbol se marca como cortado con un toque. "Etiquetas" abre una hoja imprimible con un QR por tubo.
4. **Cámara.** A los diez días, elige el muestreo, escanea el QR o escribe el código, y cuenta las yemas por estado con los botones grandes. Se ve el total, el porcentaje más allá de B-C, la media del árbol en ese muestreo y la del muestreo anterior; si la media baja, avisa antes de guardar. Al guardar salta al siguiente tubo sin leer.
5. **Exportar.** El Excel de floración de una temporada sale con la hoja por vuelo de dron y una hoja por parcela con las visitas, en el formato de los ficheros de 2026 (el de 2026, cargado y vuelto a exportar, da las mismas 474 filas celda a celda), y un CSV largo con una observación por línea para R. El Excel del forzado (hoja por muestreo, consolidada y tabla larga) sale por la hoja de compartir del móvil o como descarga. La copia de seguridad es un fichero JSON Lines con todos los eventos del dispositivo; "Restaurar o fusionar" une la copia de otro móvil sin borrar nada.

Todo queda en el dispositivo (IndexedDB). No hay cuentas ni servidor.

## Qué hay ya en `src/core/`

| Módulo | Qué hace |
| --- | --- |
| `types.ts`, `ids.ts`, `scales.ts` | Modelo de datos con vocabulario BrAPI y MIAPPE, ULIDs, códigos de tubo (`3_7_A`), escalas de floración (F0 a C90, Baggiolini), estados de yema y descriptores UPOV. |
| `forcing.ts` | Fracción de yemas más allá de B-C, media por árbol, detección de descensos y CP50 lineal, con la misma aritmética que el Rmd del grupo. |
| `phenology.ts` | Parser de las etiquetas de visita (`F95-C5`, `DE-F1`, `C30`) y derivación de F10, F50, F80, C10 y C90. |
| `events.ts`, `sampling.ts` | Registro de eventos append-only con fusión por unión entre dispositivos; planificación de muestreos y recorrido por hileras. |
| `xlsx/` | Lector y escritor de `.xlsx` propios, sin librería de hojas de cálculo; el lector devuelve rangos combinados, iconos anclados y, si se pide, el color de fuente y de relleno de cada celda; el escritor acepta color y relleno por celda. |
| `layout.ts` | La parcela como la dibuja el grupo: filas con posiciones numeradas, guardas, rellenos de patrón, símbolo de estado e identidad MOSAIC por posición; orden de recorrido y una unidad por posición. |
| `importers/` | Cuaderno de forzado por muestreos, hoja consolidada, registro de árboles y listas de floración de MOSAIC; planos de parcela dibujados en Excel (colección EEAD J4 y J5, ensayo EUFRIN L8, colección CITA 1.4 y parcela de prospección 7-1), cada uno con su dialecto. |
| `exporters/` | Cuaderno de forzado en el formato del grupo (hoja por muestreo, consolidada y tabla larga); floración en los dos formatos de 2026: hoja por vuelo de dron (estimados en rojo, no fenotipados en gris) y hoja por visita con los eventos intercalados por fecha. |

Y en `src/app/`, lo que la pantalla necesita del motor: `store.ts` (el log de eventos en IndexedDB y las acciones: cargar planos y listados fusionando por nombre de posición, anotar el estado de un árbol en una visita, deshacer, descriptores, estado, eventos del día, sugerencias) y `floweringData.ts` (la etiqueta de cada árbol y día, el conjunto de datos de una temporada para el exportador y el CSV largo).

## Qué hace (cuando esté)

| Modo | Para qué |
| --- | --- |
| Muestreo | Lista de árboles de referencia por hileras, códigos de tubo y etiquetas QR para cortar varetas. |
| Lectura de cámara | Contar yemas por estado en cada tubo, ver el porcentaje que ha salido del letargo y la curva del árbol, y recibir aviso si la curva baja. |
| Fenología | Anotar el estado de floración de cada árbol en cada visita; las fechas F10, F50, F80, C10 y C90 se derivan solas. |
| Censo | Estado de cada posición de plantación, censo tras censo, sobre la ortofoto. |

Exporta el Excel en los formatos que los grupos ya usan y una tabla larga para R, además de GeoJSON. No necesita cuentas ni servidor: los datos viven en el dispositivo y se comparten como ficheros.

## Desarrollo

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # pruebas unitarias del motor y del almacén (IndexedDB en memoria)
npm run typecheck   # motor (tsc)
npm run typecheck:app  # app Vue (vue-tsc)
npm run build       # produce docs/, que GitHub Pages sirve desde main
npm run fixtures    # reescribe los Excel sintéticos de tests/fixtures/
```

La app es una PWA con Vite, Vue 3 y Dexie; el motor (`src/core/`) no depende de Vue y es lo que prueban los tests. `python scripts/serve_docs.py` sirve `docs/` bajo `/cuaderno-campo/` para comprobar la build como la verá Pages.

Los importadores se prueban en cualquier clon contra los Excel sintéticos de `tests/fixtures/` (planos con tres dialectos, floración por vuelo con sus colores, listado por visitas, registro de árboles y cuaderno de forzado), que `scripts/make_fixtures.ts` escribe con el propio escritor xlsx en los formatos exactos del grupo y con datos inventados. Las pruebas de reproducción contra los cuadernos reales de MOSAIC 2025-2026 leen las rutas de `local.config.json` (copiar `local.config.example.json`; el fichero está ignorado por git y los datos nunca entran en el repo). Si el fichero no existe, esas pruebas se saltan.

## Licencia

MIT. Autor: Daniel González Palazón (EEAD-CSIC).
