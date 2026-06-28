import { loadEnvLocal } from "../app/lib/load-env-local";
import { getSqlClient } from "../app/lib/db/client";
import { searchPartsForAI } from "../app/lib/parts-search";

// Clearly NON-component / non-orderable libraries the AI should never place as a
// part. We deliberately do NOT mark Device (it holds the only passive symbols) —
// excluding it would leave the AI with no resistor/cap to pick.
const GENERIC_LIBS = ["power", "Graphic", "Mechanical", "Simulation_SPICE", "Jumper", "Fiducial"];

(async () => {
  loadEnvLocal();
  const sql = getSqlClient();

  // Which of the candidate libraries actually exist + their sizes.
  const present = await sql.unsafe(
    `select l.name, count(*)::int n from parts p join libraries l on p.library_id=l.id
     where l.name = any($1) group by l.name order by n desc;`,
    [GENERIC_LIBS],
  );
  console.log("Non-component libraries found:");
  for (const r of present as { name: string; n: number }[]) console.log(`  ${r.name}: ${r.n}`);

  // Reset then mark (idempotent).
  await sql.unsafe(`update parts set is_generic = false;`);
  const res = await sql.unsafe(
    `update parts set is_generic = true
     where library_id in (select id from libraries where name = any($1));`,
    [GENERIC_LIBS],
  );
  const [{ n: marked }] = await sql.unsafe("select count(*)::int n from parts where is_generic;");
  console.log(`\nMarked ${marked} parts generic (of 22756).`);

  // Verify the AI filter (excludeGenerics defaults true) still returns real parts.
  for (const q of ["10k resistor", "ESP32 module", "3.3V LDO regulator", "red LED"]) {
    const r = await searchPartsForAI(q, undefined, 3);
    console.log(`  "${q}" → ${r.length} results: ${r.map((x) => x.name).join(", ")}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
