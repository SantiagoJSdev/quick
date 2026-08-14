# KPI snapshot — verificación senior (fase 1)

Fecha: 2026-08-13 · Tienda Quick Market `0b54c944-28ba-4542-991a-4840c4801906`

## Veredicto

**Listo para dejar en producción (fase 1).** El bug de Hoy negativo vs Ayer positivo era `Store.timezone = null` (día en UTC). Corregido a `America/Caracas`. Con TZ correcta, Hoy/Ayer quedan coherentes (~misma magnitud de tickets/bruta).

## Checklist

| Ítem | Estado |
|------|--------|
| Día = `[00:00, 00:00+1)` en `Store.timezone` | OK (`sales-list-range` + test Caracas) |
| Quick Market `timezone=America/Caracas` | OK |
| `timezoneSource` + warn si fallback UTC | OK |
| `grossProfit` = net − COGS (avg o cost) − returns | OK |
| `realProfit` fase 1 = gross − bolsas − platos − nómina×días − fijos×días | OK |
| Mismo rango UTC para ventas, tickets bolsas y platos | OK |
| Payables excluye `VOID` | OK |
| Stock alerts activos only | OK |
| Logs + `realProfit.explain` auditables | OK |
| Docs front (`KPI_SNAPSHOT_FRONTEND.md` / `api/KPIS.md`) | OK |

## Comportamiento aceptado (no es bug)

- **Hoy en curso:** nómina+fijos = 1 día completo aunque las ventas aún vayan a medias → puede ser negativo temprano. Warning en `explain`.
- Bolsas = estimado 90% tickets (no conteo físico).
- Fase 2 (comisiones, faltante caja, merma, “para sacar”) **fuera** de este KPI.

## Sanity check post-fix (Caracas ~20:20)

| | Tickets | Bruta approx | Real approx (ops ~32.52) |
|--|---------|--------------|---------------------------|
| Hoy | ~194 | ~102 | ~+70 |
| Ayer | ~196 | ~93 | ~+61 |

Rango hoy UTC: `2026-08-13T04:00Z` → `2026-08-14T04:00Z` (= 00:00–24:00 Caracas).

## Front

Confiar en: `timezone === "America/Caracas"` y `timezoneSource === "store"`.  
Si `fallback_utc` → no usar Hoy/Ayer hasta corregir la tienda.
