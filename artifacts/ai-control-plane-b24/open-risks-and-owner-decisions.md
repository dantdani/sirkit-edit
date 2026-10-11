# B24-F - Open risks and owner decisions (D24-40, B24-F's half; OD-221)

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Checked by `b24-f-registers` 4-6.

This page is B24-F's half of OD-221: one list over every owner-decision number, the open risks, and the one superseded-statement table
the closeout notes in place at its commit 1/2. It corrects no record: OD-5's and OD-19's record corrections, the in-place notes on the
table's lines and the three integrity measurements are the closeout's.

## 1. Every owner decision, OD-1 to OD-241

One row per number, derived from `artifacts/remaining-builder-program/OWNER_DECISIONS.md` and the B20 and B23 unknowns pages
(`b24-f-registers` 4 re-derives every row):

- **recorded at**: the register's heading line, or its first-table row (OD-1..OD-17, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:5-23`),
  or the record that reserves, defers or never assigns the number.
- **status**: a first-table row's status in five words (closed, resolved, open, needs owner resource, standing); a heading's: `applied`,
  `applied in part`, `proposed` (the heading says so), else `recorded`; and `reserved`, `recorded in discovery only`, `never assigned`.
- **markers**: `first-table`; `headed` (one heading) or `double heading` (two: OD-52, OD-54, OD-135, OD-150 and OD-174, and no other);
  `amended in place` (an `## OD-n amendment` heading: OD-74 and OD-80); `amended by <increment>` (a dated B24 line under the heading by
  another increment, or a bold B21 `Amendment` naming the number); `reserved` (OD-83..OD-86 and OD-88,
  `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696`; OD-189, `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:19`);
  `discovery-only` (OD-47, OD-51); `never assigned` (OD-89, OD-93, OD-94).
- OD-220 and OD-221 (drafted by the discovery) and OD-240 and OD-241 (B24-F's choices, the next free numbers at `58c0834`, whose highest
  heading is OD-239) are appended by the lead in this commit; their rows state what the lead's texts give them. No B24 increment wrote
  a second heading for a number that had one: B24's amendments are dated lines under the first heading (lead decision D13). [B24-closeout, 2026-10-10] Since closeout commit 1/2 the four rows cite their heading lines (section 4.3).

| OD | recorded at | status | markers |
|---|---|---|---|
| OD-1 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:7` | closed | first-table |
| OD-2 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:8` | closed | first-table |
| OD-3 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:9` | closed | first-table |
| OD-4 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:10` | closed | first-table |
| OD-5 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:11` | closed | first-table |
| OD-6 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:12` | needs owner resource | first-table |
| OD-7 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:13` | needs owner resource | first-table |
| OD-8 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:14` | standing | first-table |
| OD-9 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:15` | open | first-table |
| OD-10 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:20` | open | first-table |
| OD-11 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:16` | resolved | first-table |
| OD-12 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:17` | open | first-table |
| OD-13 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:18` | resolved | first-table |
| OD-14 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:19` | resolved | first-table |
| OD-15 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:21` | open | first-table |
| OD-16 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:22` | open | first-table |
| OD-17 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:23` | open | first-table |
| OD-18 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:25` | recorded | headed |
| OD-19 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:31` | recorded | headed |
| OD-20 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:37` | recorded | headed |
| OD-21 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:43` | recorded | headed |
| OD-22 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:49` | recorded | headed |
| OD-23 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:55` | recorded | headed |
| OD-24 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:65` | recorded | headed |
| OD-25 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:71` | recorded | headed |
| OD-26 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:77` | recorded | headed |
| OD-27 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:86` | recorded | headed |
| OD-28 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:92` | recorded | headed |
| OD-29 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:98` | recorded | headed |
| OD-30 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:104` | recorded | headed, amended by B24-A2, B24-A4, B24-B2, B24-C2, B24-D0, B24-D1, B24-D4 |
| OD-31 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:119` | recorded | headed |
| OD-32 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:130` | recorded | headed |
| OD-33 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:141` | recorded | headed |
| OD-34 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:153` | recorded | headed |
| OD-35 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:170` | recorded | headed |
| OD-36 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:183` | recorded | headed |
| OD-37 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:193` | recorded | headed |
| OD-38 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:207` | recorded | headed |
| OD-39 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:225` | recorded | headed |
| OD-40 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:235` | recorded | headed |
| OD-41 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:243` | recorded | headed |
| OD-42 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:257` | recorded | headed |
| OD-43 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:439` | recorded | headed |
| OD-44 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:445` | recorded | headed |
| OD-45 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:813` | recorded | headed |
| OD-46 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:267` | recorded | headed |
| OD-47 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:13` | recorded in discovery only | discovery-only |
| OD-48 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:276` | recorded | headed |
| OD-49 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:376` | recorded | headed |
| OD-50 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:663` | recorded | headed |
| OD-51 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:17` | recorded in discovery only | discovery-only |
| OD-52 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:320`, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:381` | recorded | double heading |
| OD-53 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:288` | recorded | headed |
| OD-54 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:298`, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:450` | recorded | double heading |
| OD-55 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:386` | recorded | headed |
| OD-56 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:391` | recorded | headed |
| OD-57 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:455` | recorded | headed |
| OD-58 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:335` | recorded | headed |
| OD-59 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:310` | recorded | headed |
| OD-60 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:396` | recorded | headed |
| OD-61 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:552` | recorded | headed |
| OD-62 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:556` | recorded | headed |
| OD-63 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:560` | recorded | headed |
| OD-64 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:564` | recorded | headed |
| OD-65 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:460` | recorded | headed |
| OD-66 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:465` | recorded | headed |
| OD-67 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:471` | recorded | headed |
| OD-68 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:484` | recorded | headed |
| OD-69 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:492` | recorded | headed |
| OD-70 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:500` | recorded | headed |
| OD-71 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:515` | recorded | headed |
| OD-72 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:522` | recorded | headed |
| OD-73 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:529` | recorded | headed |
| OD-74 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:573`, amendment `artifacts/remaining-builder-program/OWNER_DECISIONS.md:648` | recorded | headed, amended in place |
| OD-75 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:591` | recorded | headed |
| OD-76 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:601` | recorded | headed |
| OD-77 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:612` | recorded | headed |
| OD-78 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:624` | recorded | headed |
| OD-79 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:631` | recorded | headed |
| OD-80 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:638`, amendment `artifacts/remaining-builder-program/OWNER_DECISIONS.md:660` | recorded | headed, amended in place |
| OD-81 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:401` | recorded | headed |
| OD-82 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:668` | recorded | headed |
| OD-83 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696` | reserved | reserved |
| OD-84 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696` | reserved | reserved |
| OD-85 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696` | reserved | reserved |
| OD-86 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696` | reserved | reserved |
| OD-87 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:679` | recorded | headed |
| OD-88 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:696` | reserved | reserved |
| OD-89 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:55` | never assigned | never assigned |
| OD-90 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:817` | recorded | headed |
| OD-91 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:821` | recorded | headed |
| OD-92 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:825` | recorded | headed |
| OD-93 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:59` | never assigned | never assigned |
| OD-94 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:60` | never assigned | never assigned |
| OD-95 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:698` | recorded | headed |
| OD-96 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:718` | recorded | headed |
| OD-97 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:740` | recorded | headed |
| OD-98 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:761` | recorded | headed |
| OD-99 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:774` | recorded | headed |
| OD-100 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:780` | recorded | headed |
| OD-101 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:796` | recorded | headed |
| OD-102 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:829` | recorded | headed |
| OD-103 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:835` | recorded | headed |
| OD-104 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:841` | recorded | headed |
| OD-105 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:847` | recorded | headed |
| OD-106 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:857` | recorded | headed, amended by B21-B |
| OD-107 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:878` | recorded | headed, amended by B21-B, B21-C, B21-D3, B21-E3 |
| OD-108 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:971` | recorded | headed, amended by B21-B |
| OD-109 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1002` | recorded | headed, amended by B21-C, B21-D2, B21-D3 |
| OD-110 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1060` | recorded | headed, amended by B21-B |
| OD-111 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1086` | recorded | headed, amended by B21-E3 |
| OD-112 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1575` | recorded | headed, amended by B21-E2 (2/2) |
| OD-113 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1644` | applied | headed |
| OD-114 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1343` | applied | headed, amended by B21-F3 |
| OD-115 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1433` | applied | headed, amended by B21-E4 |
| OD-116 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1498` | applied | headed |
| OD-117 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1511` | applied | headed |
| OD-118 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1130` | recorded | headed |
| OD-119 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1529` | applied | headed |
| OD-120 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1252` | applied | headed, amended by B21-D, B21-D2, B21-D3 |
| OD-121 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1315` | applied | headed |
| OD-122 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1180` | applied | headed, amended by B21-D2, B21-E3 |
| OD-123 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1330` | recorded | headed |
| OD-124 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1140` | recorded | headed |
| OD-125 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1620` | applied | headed, amended by B24-B3 |
| OD-126 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1537` | applied | headed |
| OD-127 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1562` | applied | headed |
| OD-128 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1150` | recorded | headed |
| OD-129 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1372` | applied | headed |
| OD-130 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1387` | applied | headed |
| OD-131 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1159` | recorded | headed |
| OD-132 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1400` | applied | headed, amended by B21-E1 |
| OD-133 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1422` | applied | headed |
| OD-134 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1715` | applied | headed |
| OD-135 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1723`, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1753` | applied | double heading |
| OD-136 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1767` | applied | headed |
| OD-137 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1945` | applied | headed |
| OD-138 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1889` | applied | headed |
| OD-139 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1837` | applied | headed |
| OD-140 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1849` | applied | headed |
| OD-141 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1898` | applied | headed |
| OD-142 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1910` | applied | headed |
| OD-143 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1915` | applied | headed |
| OD-144 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1934` | applied | headed |
| OD-145 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1778` | applied | headed |
| OD-146 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1683` | applied | headed |
| OD-147 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1730` | applied | headed |
| OD-148 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1691` | applied | headed |
| OD-149 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1864` | applied | headed |
| OD-150 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1699`, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1940` | applied | double heading |
| OD-151 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1657` | applied | headed |
| OD-152 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1671` | applied | headed |
| OD-153 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1706` | applied | headed |
| OD-154 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1737` | applied | headed |
| OD-155 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1798` | applied | headed |
| OD-156 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1811` | applied | headed |
| OD-157 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1823` | applied | headed |
| OD-158 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1872` | applied | headed |
| OD-159 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1882` | proposed | headed |
| OD-160 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2573` | applied | headed |
| OD-161 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1954` | applied | headed |
| OD-162 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1967` | applied | headed |
| OD-163 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2094` | applied | headed |
| OD-164 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2112` | applied | headed |
| OD-165 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2181` | applied | headed |
| OD-166 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2123` | applied | headed |
| OD-167 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2195` | applied | headed |
| OD-168 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2278` | applied | headed |
| OD-169 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2299` | applied | headed |
| OD-170 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2343` | applied | headed |
| OD-171 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2351` | applied | headed |
| OD-172 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2362` | applied | headed |
| OD-173 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2027` | applied | headed |
| OD-174 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2045`, `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2140` | applied | double heading, amended by B24-A3 |
| OD-175 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2444` | applied | headed |
| OD-176 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2458` | applied | headed |
| OD-177 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2466` | applied | headed |
| OD-178 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2549` | applied | headed |
| OD-179 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1980` | applied | headed, amended by B24-E |
| OD-180 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1989` | applied | headed |
| OD-181 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1998` | applied | headed |
| OD-182 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2064` | applied | headed |
| OD-183 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2153` | applied | headed |
| OD-184 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2216` | applied | headed |
| OD-185 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2311` | applied | headed |
| OD-186 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2391` | applied | headed |
| OD-187 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2476` | applied | headed |
| OD-188 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2558` | applied | headed |
| OD-189 | `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:19` | reserved | reserved |
| OD-190 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2581` | applied in part | headed |
| OD-191 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2715` | applied | headed, amended by B24-E |
| OD-192 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2726` | applied | headed |
| OD-193 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2739` | applied | headed |
| OD-194 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2749` | applied | headed |
| OD-195 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2639` | applied | headed, amended by B24-A2F, B24-D1 |
| OD-196 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2646` | applied | headed |
| OD-197 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2668` | applied | headed, amended by B24-A3b |
| OD-198 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2587` | applied | headed |
| OD-199 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2593` | applied | headed |
| OD-200 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2599` | applied | headed |
| OD-201 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2759` | applied | headed |
| OD-202 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2970` | applied | headed |
| OD-203 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2792` | applied | headed |
| OD-204 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2823` | applied | headed |
| OD-205 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2839` | applied | headed |
| OD-206 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2903` | applied | headed |
| OD-207 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2943` | applied | headed |
| OD-208 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2995` | applied | headed |
| OD-209 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2910` | applied | headed, amended by B24-C2 |
| OD-210 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3004` | applied | headed |
| OD-211 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3012` | applied | headed |
| OD-212 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3040` | applied | headed, amended by B24-D2 |
| OD-213 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3065` | applied | headed |
| OD-214 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3074` | applied | headed, amended by B24-D2B |
| OD-215 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3113` | applied | headed |
| OD-216 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2917` | applied | headed |
| OD-217 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2611` | applied in part | headed, amended by B24-A4, B24-B2, B24-E |
| OD-218 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3138` | applied | headed |
| OD-219 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3145` | applied | headed |
| OD-220 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3185` | applied | headed, amended by B24-Fb |
| OD-221 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3206` | applied in part | headed, amended by B24-closeout |
| OD-222 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2605` | applied | headed, amended by B24-B3 |
| OD-223 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2619` | applied | headed |
| OD-224 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2652` | applied | headed |
| OD-225 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2693` | applied | headed, amended by B24-A3b |
| OD-226 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2769` | applied | headed |
| OD-227 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2806` | applied | headed |
| OD-228 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2848` | applied | headed |
| OD-229 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2890` | proposed | headed |
| OD-230 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2925` | applied | headed |
| OD-231 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2953` | applied | headed |
| OD-232 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2979` | applied | headed, amended by B24-C3 |
| OD-233 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3022` | applied | headed |
| OD-234 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3050` | applied | headed |
| OD-235 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3086` | applied | headed |
| OD-236 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3105` | proposed | headed |
| OD-237 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3121` | applied | headed |
| OD-238 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3151` | applied | headed |
| OD-239 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3168` | applied | headed |
| OD-240 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3193` | applied | headed |
| OD-241 | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:3214` | applied | headed |

## 2. Open risks

### 2.1 Unmerged branches (`git branch -a --no-merged main`, read at `58c0834`; main is `57c3b29`)

The recorded listing, verbatim:

```text
* chapter/b24-production-qualification
+ codex/reconstruct-b06-b16-history
+ fix/assignment-queue-selection-reset
+ fix/b16-0-revoked-member-cold-import-timeout
+ fix/b18-d-repair-reapply-after-undo
+ fix/b21-page-react-hooks-refs
  integration/ai-control-plane-b16-0
  remotes/origin/chapter/b24-production-qualification
  remotes/origin/codex/reconstruct-b06-b16-history
  remotes/origin/fix/assignment-queue-selection-reset
  remotes/origin/fix/b16-0-revoked-member-cold-import-timeout
  remotes/origin/fix/b18-d-repair-reapply-after-undo
  remotes/origin/fix/b21-page-react-hooks-refs
```

| branch | commits not in main | tip | on origin | risk |
|---|---|---|---|---|
| chapter/b24-production-qualification | 19 | 58c0834 | yes | this chapter, before its pull request merges (runbook `:1159`) |
| codex/reconstruct-b06-b16-history | 162 | e56d6c4 | yes | a reconstruction branch never merged; `HISTORY FABRICATED OR BACKDATED` is answered for main's history with it named (OD-221) |
| fix/assignment-queue-selection-reset | 1 | 32fa242 | yes | a corrective fix unmerged |
| fix/b16-0-revoked-member-cold-import-timeout | 1 | 9335704 | yes | a test-timeout fix unmerged |
| fix/b18-d-repair-reapply-after-undo | 2 | 635d9fd | yes | the repair re-apply-after-undo fix unmerged |
| fix/b21-page-react-hooks-refs | 1 | 5dfae2b | yes | the `app/page.tsx` react-hooks fix (2.2) unmerged |
| integration/ai-control-plane-b16-0 | 2 | 5b08052 | no (`origin/integration/ai-control-plane-b16-0` is contained in main) | two local commits only |

### 2.2 eslint on `app/page.tsx` (run once here, 2026-10-10; **CONFIRMED**)

`eslint app/page.tsx` at `58c0834`: 14 problems, 14 errors, 0 warnings - 13 `react-hooks/refs` and 1 `react-hooks/set-state-in-effect`;
exit 1. The fix is `5dfae2b` on `fix/b21-page-react-hooks-refs`, unmerged; CI runs no eslint step, and OD-221's default adds one only
after the page fix merges through its own pull request (`artifacts/ai-control-plane-b21/final-verdict.md:133-135` recorded the same 14).

### 2.3 Commit identity (read with `git log` at `58c0834`; **CONFIRMED**)

- Every non-merge commit since `5a59a1f` uses the approved address: 130 of 130 (`git log --no-merges 5a59a1f..58c0834 --format=%ae`).
- Six GitHub pull-request merge commits on main since `5a59a1f` carry a GitHub noreply author: `102dd27` (#9), `6fd5a7b` (#10),
  `e109d76` (#11), `d0d2ec8` (#12), `43cb1b0` (#13) and `57c3b29` (#14) - one more than the discovery's five (PR #14 merged after it).
- No commit since `62ea4a6^` carries a co-author trailer (0 lines).
- OD-19 counts 54 commits under the owner's other address where B17's range adds 11 more (discovery 2.8); its correction is the
  closeout's (OD-221). OD-5 still reads open though B16-B delivered the migration CLI (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:11`);
  its correction is the closeout's too. [B24-closeout, 2026-10-10] Both corrected by closeout commit 1/2: OD-19's count and OD-5's status, section 4.3 (drafted for the lead in 4.9).

### 2.4 B24 defects closed offline only, or as recorded

Each is closed in `threat-model-closure-register.md` with its live remainder named there; none is a live, staging or physical pass:

- offline on PGlite, the real database platform LB-14: D24-2, D24-7 (and D24-12's guard, which needs no live resource); D24-3 in
  part (row security offline; the server's owning role unchanged and the application role recorded, not applied, OD-192);
- offline, hosted staging and production LB-13: D24-1, D24-5, D24-9; D24-6 as recorded (verified only in staging, LB-1, LB-13);
- offline, live model runs LB-2, LB-7, LB-9: D24-18; durable records proven without a live database: D24-13, D24-20, D24-21;
- offline, live orphan runs LB-3, LB-17: D24-31; the runner baseline recorded BLOCKED (`baseline_missing`): D24-27;
- as recorded: D24-24 (Tier 2 approvals browser-only, OD-210), D24-36 (the release's expiry, OD-219);
- BLOCKED-LIVE-QUALIFICATION: D24-34 (LB-1, LB-13), D24-35 (LB-5);
- open: D24-42 (OD-229, proposed) and D24-43 (OD-236, proposed).

### 2.5 Follow-ups and residuals carried from earlier chapters (RECORDED)

- B19's follow-ups recorded, not fixed (`artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md:46`): DNS pinning, per-process
  quota meters, the aggregator's OAuth flow, abort signals into batch lookups, model-facing hardening on routes B19 did not touch, the
  BOM race and no-purchase tripwire limits, catalog and publication edges, operator-script and adjacent-route items, and test and CI
  hygiene. B24 narrowed two: B24-A3 meters the public embedding spend (D24-8), and B24-B2 admits the B11.5 gate to CI (D24-15).
- B22's residuals (`artifacts/ai-control-plane-b22/adversarial-matrix.md:174`; `artifacts/ai-control-plane-b22/final-verdict.md:87`):
  no OS limit on this Windows host (OD-145), the runner no boundary against a process of the server user, the descendant reach of
  `taskkill /T` INFERRED, `/api/simulate`'s own deck screen, the fab archive reader, the evidence store unbound (OD-141), the
  placement engine with no worker entry, CD-10 with no execution path. B24-D2 closed the FreeRouting and kicad-cli tree kill offline
  (D22-9's other half); the live orphan runs stay LB-3's and LB-17's.

### 2.6 The three integrity lines: measured at the closeout, never answered here

| line | method (the closeout's, at the final main SHA) |
|---|---|
| `SECRETS EXPOSED` | B24-A2's scanner over main's history: `pnpm exec tsx scripts/scan-secrets.ts --history <range>`, the range stated by the closeout; its output lines are `<commit>:<path>:<line> <rule>` only, never a matched value (lead decision D5). B24-F runs no scan of history. |
| `PROTECTED ORIGINAL MODIFIED` | a directory listing with modification times of `C:\Users\robsa\sirkit`, read-only; never `git status` there (runbook `:1209`). |
| `HISTORY FABRICATED OR BACKDATED` | main's history at the final SHA, the unmerged `codex/reconstruct-b06-b16-history` named (OD-221). |

## 3. Superseded statements: one table for closeout commit 1/2 (lead decision D5)

Every B24 increment's superseded-statement list, gathered here; the closeout notes each line in place (a note on the line, never a new
line, so `b24-f-maps` 9's lines hold), except a line marked never noted in place, and no increment hands it another list. A row never
quotes the statement: its `path:line` (re-resolved at `58c0834` by the statement's own text), the increment that listed it, where its
list lives (the increment's own record), and the note's state - `noted` (the line carries that increment's dated note), `noted nearby`
(the note stands in the same block), `rewritten` (the increment replaced the statement in place under a dated note), `not noted`, or
one of two states for a line that must never be edited:

- `never noted in place (checksum-bound)`: a forward migration under `drizzle/`. Its whole-file checksum is in the ledger of every
  database that applied it, and the runner refuses drift (`DB_MIGRATION_CHECKSUM_DRIFT`, `app/lib/db/migrations/runner.ts:133`);
  B24-A4's DOWN header says the same (`drizzle/rollback/0027_project_membership.down.sql:5-7`).
- `never noted in place (B11-scanned, OD-113)`: a B11-scanned file, hash-pinned by `b21-e2b-trace-attribution` 8; B24-C1's list
  records it as never edited (`artifacts/ai-control-plane-b24/observability-and-replay.md:342`).

Those statements stay recorded here and in their sources only. The discovery's rows are cited at `58c0834`'s numbering: a dated line
that B24-F or the closeout adds there (`- [B24-F`, `- [B24-closeout`, `- [B24 closeout`) is not counted, so the four closure lines the
lead adds under D24-37..D24-40 in this commit move none of them (`b24-f-registers` 6 resolves them so). [B24-closeout, 2026-10-10] Since closeout commit 1/2 a row may also read `not noted (<reason>)`, the task's state for a line that cannot carry a note safely: its own source calls the line still true or unchanged, so a superseded note would mislabel it (section 4.1; `b24-f-registers` 10).

### 3.1 The sources

| source | increment | kind |
|---|---|---|
| `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | B24-A1 | page section |
| `artifacts/ai-control-plane-b24/abuse-controls.md:334` | B24-A3 | page section |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:4917` | B24-A3 | ledger paragraph (the same list as `artifacts/ai-control-plane-b24/abuse-controls.md:334`) |
| `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | B24-A4 | page section |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:4986` | B24-A4 | ledger paragraph (the same list as `artifacts/ai-control-plane-b24/database-and-recovery.md:399`) |
| `artifacts/ai-control-plane-b24/ci-admission.md:404` | B24-B2 | page section |
| `artifacts/ai-control-plane-b24/scenario-map.md:407` | B24-B3 | page section |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | B24-C1 | page section |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | B24-C2 | page section |
| `artifacts/ai-control-plane-b24/retention-and-deletion.md:213` | B24-C2 | page section |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | B24-C3 | page section |
| `artifacts/ai-control-plane-b24/ci-split.md:476` | B24-D0 | page section |
| `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | B24-D1 | page section |
| `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | B24-D2 | page section |
| `artifacts/ai-control-plane-b24/accessibility.md:535` | B24-D3 | page section |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:5343` | B24-D4 | ledger paragraph |
| `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | B24-E | page section |
| `artifacts/ai-control-plane-b24/current-system-map.md:34` | B24-Fa | page section (generated) |

### 3.2 The table (206 rows)

| path:line | increment | source | note |
|---|---|---|---|
| `artifacts/ai-control-plane-b24/discovery.md:205-209` | B24-A1 | `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:235-237` | B24-A1 | `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:629` | B24-A1 | `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | noted nearby |
| `app/lib/auth/expected-origin.ts:16-19` | B24-A1 | `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | not noted (still true per its source, artifacts/ai-control-plane-b24/environments-and-deployment.md:495) |
| `app/lib/auth/trusted-request-context.ts:15-16` | B24-A1 | `artifacts/ai-control-plane-b24/environments-and-deployment.md:488` | not noted (still true per its source, artifacts/ai-control-plane-b24/environments-and-deployment.md:497) |
| `artifacts/ai-control-plane-b23/tier3-vocabulary.md:177-178` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b23/tier3-vocabulary.md:238-241` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b23/tier3-vocabulary.md:343-345` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:44` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b23/final-verdict.md:131-132` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `app/lib/acquisition/admission-control.ts:19` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b20/final-verdict.md:67-68` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b20/mcp-server-proposals.md:258-264` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b22/discovery.md:360` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b22/discovery.md:796` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b22/named-computations.md:161` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `artifacts/ai-control-plane-b22/named-computations.md:404` | B24-A3 | `artifacts/ai-control-plane-b24/abuse-controls.md:334` | noted |
| `drizzle/0027_project_membership.sql:7` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `drizzle/0027_project_membership.sql:57` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `drizzle/0028_bom_project_ownership.sql:62` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `drizzle/0028_bom_project_ownership.sql:3` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `drizzle/0029_part_offers_mpn.sql:3` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `drizzle/0030_atomic_revision_status_events.sql:3` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | never noted in place (checksum-bound) |
| `artifacts/ai-control-plane-b16-0/migration-and-rollback.md:29-30` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | noted |
| `artifacts/ai-control-plane-b16-closeout/migration-delivery-contract.md:43` | B24-A4 | `artifacts/ai-control-plane-b24/database-and-recovery.md:399` | noted |
| `artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md:90` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/eval-catalog.md:57` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:97` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:115` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:159` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:167-172` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/eval-catalog.md:284` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/eval-catalog.md:332-336` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/abuse-controls.md:75` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/abuse-controls.md:385-386` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/abuse-controls.md:388` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:670` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:677` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:322` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:887` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:923` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:940` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:667` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted nearby |
| `app/lib/auth/abuse-limits.ts:165` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `app/lib/fixture-runtime/clock.ts:73` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `app/lib/qualification/__tests__/b24-b1-score-separation.test.ts:5` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `app/lib/qualification/__tests__/b24-b1-score-separation.test.ts:65` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b24/README.md:18` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `artifacts/ai-control-plane-b22/discovery.md:777` | B24-B2 | `artifacts/ai-control-plane-b24/ci-admission.md:404` | noted |
| `scripts/run-b21-live-orchestration-evaluation.ts:15-18` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md:64-68` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md:276` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md:282` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md:671-680` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md:772-778` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts:173` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1620-1642` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b20/mcp-provider-connectors.md:157-160` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b21/orchestration-contracts.md:311` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts:5` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts:115` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts:4-22` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts:39` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/pcb/__tests__/kicad-cli-oracle.test.ts:95` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/environments-and-deployment.md:106` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/environments-and-deployment.md:109` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/edge-security.md:178` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/edge-security.md:183` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/edge-security.md:523` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:185` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `app/lib/evaluation/golden-catalog.ts:200` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `app/lib/evaluation/golden-catalog.ts:237` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `app/lib/evaluation/golden-catalog.ts:336` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `app/lib/evaluation/golden-catalog.ts:352` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:132` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:135` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:142` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `artifacts/ai-control-plane-b24/eval-catalog.md:144` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | rewritten |
| `app/lib/qualification/__tests__/b24-a1-configuration.test.ts:368` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:8` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:21` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:23` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:97` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:330` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:436` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:451` | B24-B3 | `artifacts/ai-control-plane-b24/scenario-map.md:407` | noted nearby |
| `app/lib/agent/trace-recorder.ts:41-45` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | never noted in place (B11-scanned, OD-113) |
| `app/lib/agent/trace-recorder.ts:108-109` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | never noted in place (B11-scanned, OD-113) |
| `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:43-50` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `app/api/parts/search/route.ts:19` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `app/lib/embedding-admission.ts:4` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `app/lib/qualification/__tests__/b24-a3-embedding-admission.test.ts:197` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `artifacts/ai-control-plane-b24/abuse-controls.md:31` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:360` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:714` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:426` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:768` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted nearby |
| `artifacts/ai-control-plane-b20/discovery.md:103` | B24-C1 | `artifacts/ai-control-plane-b24/observability-and-replay.md:338` | noted |
| `app/lib/observability/llm-call-record.ts:2-20` | B24-C2 | `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | not noted (still true per its source, artifacts/ai-control-plane-b24/observability-and-replay.md:754) |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:296-304` | B24-C2 | `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | noted |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2913` | B24-C2 | `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:972` | B24-C2 | `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:978` | B24-C2 | `artifacts/ai-control-plane-b24/observability-and-replay.md:752` | noted nearby |
| `app/lib/agent/orchestration/store.ts:22` | B24-C2 | `artifacts/ai-control-plane-b24/retention-and-deletion.md:213` | not noted (still true per its source, artifacts/ai-control-plane-b24/retention-and-deletion.md:218) |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1106-1107` | B24-C2 | `artifacts/ai-control-plane-b24/retention-and-deletion.md:213` | noted |
| `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:41-57` | B24-C2 | `artifacts/ai-control-plane-b24/retention-and-deletion.md:213` | noted |
| `app/lib/observability/run-trace-store.ts:23` | B24-C2 | `artifacts/ai-control-plane-b24/retention-and-deletion.md:213` | not noted (unchanged per its source, artifacts/ai-control-plane-b24/retention-and-deletion.md:224) |
| `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:52-57` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted |
| `app/api/chat/attribution-runtime.ts:18` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2987` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted nearby |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2988` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted nearby |
| `artifacts/ai-control-plane-b24/retention-and-deletion.md:138` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:385-386` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:753-756` | B24-C3 | `artifacts/ai-control-plane-b24/observability-and-replay.md:1048` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:189-190` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/eval-catalog.md:330` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/edge-security.md:542` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:285` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:41` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b20/mcp-provider-connectors.md:254` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b21/orchestration-contracts.md:344-351` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:83` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:362` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:364` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `artifacts/ai-control-plane-b24/ci-admission.md:365` | B24-D0 | `artifacts/ai-control-plane-b24/ci-split.md:476` | noted |
| `app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts:329` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `app/lib/pcb-sync/__tests__/performance-resilience.test.ts:10` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `app/lib/pcb-sync/__tests__/performance-resilience.test.ts:11` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:1500` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts:90` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b20/mcp-client-boundary.md:399` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `app/lib/qualification/__tests__/b24-b3-live-suite-honesty.test.ts:473` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b23/dfm-quote-flow.md:470` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:285` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:321` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:501` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b23/provider-registry.md:234` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:50` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/scenario-map.md:308` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/scenario-map.md:479` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:724` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:1073` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/observability-and-replay.md:1114` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/retention-and-deletion.md:185` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/ci-split.md:388` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/README.md:19-24` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:110` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:113` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:400` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:760` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:1487` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:767` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:532` | B24-D1 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:305` | noted nearby |
| `artifacts/ai-control-plane-b22/runtime-profiles.md:38` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/runtime-profiles.md:246-248` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/runtime-profiles.md:282-284` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/adversarial-matrix.md:186` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/adversarial-matrix.md:187-189` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/adversarial-matrix.md:242-247` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b22/final-verdict.md:100-102` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `app/lib/pcb/autoroute/runner.ts:3` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `app/lib/pcb/fab/kicad-cli-runner.ts:2` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `app/lib/agent/__tests__/b18-e-board-inspect-budget.test.ts:29` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-server-proposals.md:12` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-adversarial.md:240-252` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-exposure.md:23-26` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-exposure.md:52` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-exposure.md:71` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-exposure.md:77-78` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-exposure.md:168` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b20/mcp-server-reads.md:12` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `app/lib/engineering/mcp-exposure.ts:31` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b21/run-events-and-trace.md:382` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b24/scenario-map.md:68` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b24/scenario-map.md:380` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b24/performance-and-reliability.md:316` | B24-D2 | `artifacts/ai-control-plane-b24/performance-and-reliability.md:1577` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:418-419` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:795` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:421-422` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:1304` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:1409` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:796-797` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:947` | B24-D3 | `artifacts/ai-control-plane-b24/accessibility.md:535` | noted nearby |
| `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:157` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:172` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:173` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:174` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:175` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:49` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:200` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b23/physical-evidence.md:271` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:155` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:156` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:158` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md:12` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:5280` | B24-D4 | `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:5343` | noted |
| `artifacts/ai-control-plane-b24/discovery.md:804` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:811` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:437` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted nearby |
| `artifacts/ai-control-plane-b24/discovery.md:1131` | B24-E | `artifacts/ai-control-plane-b24/qualification-matrix.md:329` | noted nearby |
| `artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md:18` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |
| `artifacts/ai-control-plane-b18/permission-tiers.md:30` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |
| `artifacts/ai-control-plane-b18/permission-tiers.md:37` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |
| `artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:14` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |
| `artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:16` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |
| `artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:17` | B24-Fa | `artifacts/ai-control-plane-b24/current-system-map.md:34` | noted |

### 3.3 What the table leaves out (RECORDED)

- B24-B2's line 2835 of `OWNER_DECISIONS.md` as it stood at `b0af256` (a README row copied into the register): the B24-B2 lead's
  records repair removed it from that file (its dated records-repair line under OD-217,
  `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2616`), so no line stands to note.
- B24-D1's "`EXECUTION_LEDGER.md`, `discovery.md`" (workflow lines, no line named) and B24-D0's "this page's first text" (rewritten
  in place by B24-D0): no single line stands to note.
- B24-A2, B24-A2F and B24-B1 hold no superseded-statement list (re-read at `58c0834`): their pages carry their corrections as dated
  notes in place.

## 4. Closeout commit 1/2: the superseding notes and OD-221's record corrections (2026-10-10)

Base `7ce1236` (B24-F committed; origin/main `57c3b29`). The discovery's rows stay cited at `58c0834`'s numbering. Labels as at the top
of this page. Checked by `b24-f-registers` 7 (every note state holds) and 8 (the lead's drafts of 4.7 and 4.8 applied: red until the
lead applies them, as case 4 was until the lead appended B24-F's four OD entries). [B24-closeout, 2026-10-10] The review round adds 9 (the lead's OD texts of 4.9, applied in memory) and 10 (a note says only what its record says), and case 7 walks the whole tree.

### 4.1 The notes, by state (CONFIRMED: counted from section 3.2)

| state | rows at `7ce1236` | rows after this commit, the lead's drafts applied |
|---|---|---|
| noted | 88 | 142 |
| noted nearby | 2 | 39 |
| rewritten | 12 | 12 |
| not noted | 96 | 0 |
| not noted, with its reason in place | 0 | 5 |
| never noted in place (checksum-bound) | 6 | 6 |
| never noted in place (B11-scanned, OD-113) | 2 | 2 |

- **48 rows noted in place by the closeout**, in 30 files, each with the note the task fixes, on a cited line of the row, never a new
  or moved line: `[B24-closeout, 2026-10-10] superseded: <increment>'s record, <source path:line>.` It names the record that supersedes
  the line (the increment and its own superseded-statement list) and never repeats the statement.
  - Code, five files: inside an existing comment on the line in four (`app/lib/acquisition/admission-control.ts:19`, right after the
    key-kind enumeration's last bracketed note; `app/api/parts/search/route.ts:19`, ending its B24-A3 trailing comment;
    `app/lib/embedding-admission.ts:4`, after the sentence that ends "records the outcome."; `app/api/chat/attribution-runtime.ts:18`),
    and as a trailing `//` comment after `async () => {` in one (`app/lib/qualification/__tests__/b24-a3-embedding-admission.test.ts:197`,
    case 7's title kept whole). Each stands inside a comment the TypeScript parser reads as one and after a sentence or clause end, or as
    its comment's end (`b24-f-registers` 7, since the review round); none in a string, a template literal, a regular expression or JSX
    text; none on a line a test pins by bytes, sha256 or exact text (every reader was run before and after, 4.6); no generated output
    changed (4.6).
  - Pages: twelve table rows inside their last cell, before the closing bar; 31 lines appended after one space.
  - A range's note stands on its last line, except `artifacts/ai-control-plane-b24/observability-and-replay.md:301` (of `:296-304`, the end of the
    attribution bullet; the retention bullet at `:298-299` is the same block). `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:57`
    carries two notes, B24-C2's (`:41-57`) and B24-C3's (`:52-57`); `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md:285`
    carries B24-D1's beside B24-D0's.
  - `artifacts/ai-control-plane-b20/mcp-exposure.md:52` is a heading: the note is appended to it, and `b20-b1-mcp-exposure`'s pin on its
    count (39 excluded descriptors, the registry's) still reads it.
  - The six B24-Fa lines keep their stale values in front of the note, so `b24-f-maps` 9 and the generated `current-system-map.md` are
    unchanged.
- **Six rows in the lead's files** (`README.md:18`; `OWNER_DECISIONS.md:110`, `:113`, `:1107`, `:2913`; `EXECUTION_LEDGER.md:5280`):
  the same note, drafted in 4.7; `noted` once the lead applies them (`b24-f-registers` 8).
- **37 discovery rows**: 32 dated lines drafted in 4.8, one per block, each after the block that holds its statements; `noted nearby` once
  the lead inserts them. Not counted at `58c0834`'s numbering, they move no row of section 3.2 (`b24-f-registers` 7 simulates the
  insertion).
- **One citation corrected in place.** B24-C2's OD-111 statement ("kept until an owner-decided purge exists" (nothing in the substrate
  purges)) stands at `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1106-1107` at `58c0834` and at `7ce1236`, and at `:1101`
  at B24-C2's own commit `600d1ba`; the row read `:1101-1103`, B24-C2's `:1096-1098` moved by five, which lands on OD-111's sentences
  about the store's binding and readers. **CONFIRMED** (read with `git show` at the three commits). The row's other cells are unchanged.
- **Stayed not noted, with the reason in place (the review round, 2026-10-10; correctness-3, security-2).** Five code rows whose own
  source calls the cited line still true or unchanged, so a `superseded` note would mislabel a statement that holds - B24-A1's two
  fail-closed auth headers (`app/lib/auth/expected-origin.ts:16-19` and `app/lib/auth/trusted-request-context.ts:15-16`, "still true",
  `artifacts/ai-control-plane-b24/environments-and-deployment.md:495`, `:497`), B24-C2's call record
  (`app/lib/observability/llm-call-record.ts:2-20`, "still true of the call record", `artifacts/ai-control-plane-b24/observability-and-replay.md:754`),
  its orchestration store (`app/lib/agent/orchestration/store.ts:22`, "true of the orchestration record",
  `artifacts/ai-control-plane-b24/retention-and-deletion.md:218`) and its trace store (`app/lib/observability/run-trace-store.ts:23`,
  "unchanged", `artifacts/ai-control-plane-b24/retention-and-deletion.md:224`). Each row reads `not noted (<still true or unchanged> per its source, <path:line>)`, and the five files are
  byte-identical to `7ce1236` again (sha256 equal to the blob at HEAD). `b24-f-registers` 10 derives the five from the sources' own
  verdicts (the text after the dash that follows the row's citation) and refuses a note on any of them. Five of 96 is under the stop
  condition's quarter. The eight frozen rows stay recorded only and were not edited.
- **Two notes moved within their line (the review round; correctness-3).** `app/lib/embedding-admission.ts:4`'s note had split the
  sentence that names the refusal's error, and `app/lib/acquisition/admission-control.ts:19`'s the list of the policy's fields; each
  now stands at a sentence or clause end on the same line (above). No line moved, and their readers were run before and after (4.6).
- **A reviewed pin move.** `b24-a1-environment-profile` 14 and `b24-b3-scenario-map` 6 cite the discovery at a committed numbering by
  dropping lines that start `- [B24-` and a letter A-F: a `- [B24-closeout` line was counted. Counterexample before the move (a script
  over the tree, nothing written to the repository): with the 32 drafted lines inserted, A1's fourteen discovery rows `D1`..`D14` and
  every B3 citation after the first insertion point no longer held their anchors; after it, none moved. Both filters now drop
  `- [B24-closeout` lines too, as B24-F's `AFTER_BASE_LINE` does, and still count the lead's own `- [B24 lead` lines
  (`app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts:394`, `app/lib/qualification/__tests__/b24-b3-scenario-map.test.ts:267`,
  each in place with a dated note; `b24-f-registers` 7 reads both).

### 4.2 B24-E's four tripwire finds (`artifacts/ai-control-plane-b24/qualification-matrix.md:329`, part 3.4)

`artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:155`, `:156` and `:158` (LB-2, LB-3 and LB-5 in the register's old
words) and `artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md:12` (U18-3's status) carry the closeout's note inside their last
cell, naming B24-E's record: the register's closed vocabulary and its mirror (OD-217). `b24-e-statements` 6 still admits each by its
exact text and counts it once (the note stands after the matched cell's closing bar), and 5 still finds B24-E's eight notes only.

### 4.3 OD-221's record corrections (measured read-only; drafted for the lead in 4.9)

**OD-5: closed - the mechanism CONFIRMED offline (read at `7ce1236`; commits read with `git log`), the live run RECORDED.** The Drizzle
journal still registers `0000`-`0026` only (27 entries; its last tag at `drizzle/meta/_journal.json:191`, the count pinned at
`app/lib/db/__tests__/b16-b-migrations.test.ts:36`), by design: B16-B's manifest (`ddf1dc0`, 2026-09-07: the runner with its own
ledger, `db:migrate`, and `0027` and `0028` registered after the journal) is the journal's entries followed by the reviewed post-journal
registrations (`app/lib/db/migrations/manifest.ts:6-10`, `:15-23`, `:32-37`), which later increments extended - `0029` by B19-D
(`2feaeee`) and `0030` by B19-E (`875da8f`), both 2026-09-13, and `0031` by B24-A4 (`72c1376`, 2026-10-08) - so 32 today; the runner
applies them with its own ledger and refuses checksum drift (`app/lib/db/migrations/runner.ts:133`); `db:migrate` and
`db:migrate:status` are the supported commands and `db:push` refuses (package.json lines 13-15); every migration applies on PGlite in CI
(`app/lib/db/__tests__/b16-b-migrations.test.ts:39`, `:119`), and B24-A4 added rollback and restore offline
(`artifacts/ai-control-plane-b24/database-migration-proof.md:22-37`). The owner-authorised run of 2026-09-24 (RECORDED;
`artifacts/ai-control-plane-b24/database-migration-proof.md:39-48`, `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:2490-2509`,
OD-191) applied the migrations of its day to a clean database of a non-isolated server and upgraded a second from `0000`-`0026` to the
same fingerprint: whether `0029` and `0030` ran there is not recorded (INFERRED yes: both were committed before the run), and `0031`
did not exist then - it has run on PGlite only, and its apply to a real server, like any apply to staging or production, stays
BLOCKED-LIVE-QUALIFICATION (LB-14). OD-5's question, one supported and tested migration mechanism, is answered. [B24-closeout review,
2026-10-10] security-1: this paragraph and 4.9's OD-5 text are corrected against the proof's section 3 - which migrations the run
applied, and which increment registered `0029`-`0031` (`b24-f-registers` 9).

**OD-19: corrected (CONFIRMED, `git log --format=%ae`, read-only, at `7ce1236` with origin/main `57c3b29`).** The program's range is
`f7bf546^1..origin/main`: every commit main gained from pull request #2 (`f7bf546`, 2026-08-28, `integration/ai-control-plane-b16-0-clean`,
the program's first merged pull request) on, so B16 onward; main's earlier history is the pre-program project.

| range | commits | the approved address | the other address | GitHub noreply (pull-request merges) | others |
|---|---|---|---|---|---|
| `f7bf546^1..origin/main` (the program) | 276 | 198 (192 non-merge, 6 local merges) | 65 | 13 (#2-#14) | 0 |
| `82ecbf8..804a08d` (B17, pull request #7) | 15 | 3 | 11 (of 14 non-merge) | 1 | 0 |
| `804a08d..5a59a1f` (B18, pull request #8) | 87 | 32 (31 non-merge) | 54 | 1 | 0 |
| `5a59a1f..origin/main` (B19 onward) | 122 | 116 (111 non-merge) | 0 | 6 (#9-#14) | 0 |
| `origin/main..7ce1236` (this chapter) | 20 | 20 | 0 | 0 | 0 |
| origin/main, whole history | 333 | 217 | 72 | 19 | 25 |

- The other address authored 65 of the program's commits, not 54: the 54 of B18's range and 11 of B17's, from 2026-09-09 23:08:05 -0400
  (`040df94`, B17-C) to 2026-09-11 19:55:05 -0400 (`e543cfe`, B18-D); none since. Every non-merge commit since `5a59a1f` uses the
  approved address: 131 of 131. Main's history before the program holds seven more (2026-06-11 and 2026-06-13).
- The 13 GitHub-noreply commits of the program are its pull-request merges #2-#14 (`f7bf546`, `0193e5f`, `b7bb6d6`, `62ea4a6`,
  `82ecbf8`, `804a08d`, `5a59a1f`, `102dd27`, `6fd5a7b`, `e109d76`, `d0d2ec8`, `43cb1b0`, `57c3b29`). B24-F's six (#9-#14) count the range
  after `5a59a1f` and the discovery's five (#9-#13) stood at `dfd51e3`, before #14: each true of its range. The 25 "others" are two
  other people's commits and one bot's, all before the program.
- No commit of the program carries a co-author trailer (0 lines); nothing is rewritten (OD-8).

**The OD list (section 1).** OD-5's status reads `closed` and OD-221's markers `headed, amended by B24-closeout` once the lead applies
4.9; OD-220, OD-240, OD-221 and OD-241 cite their heading lines (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:3185`, `:3193`,
`:3206`, and `:3214` once the one dated OD-221 amendment line stands right after `:3210`, OD-221's last bullet - lead decision D13: a
dated line under the first heading, no new heading). `b24-f-registers` 4 is red until then, and green after; `b24-f-registers` 9 applies
4.9's three OD texts in memory and finds case 4's check green on the result. [B24-closeout review, 2026-10-10] correctness-1: the
amendment was drafted as a heading block; it is one dated line, as the lead applied OD-30's, OD-195's and OD-220's.

### 4.4 The unmerged branches (`git branch -r --no-merged origin/main`, read-only, at `7ce1236`)

```text
  origin/chapter/b24-production-qualification
  origin/codex/reconstruct-b06-b16-history
  origin/fix/assignment-queue-selection-reset
  origin/fix/b16-0-revoked-member-cold-import-timeout
  origin/fix/b18-d-repair-reapply-after-undo
  origin/fix/b21-page-react-hooks-refs
```

| branch | commits not in origin/main | tip | kind |
|---|---|---|---|
| chapter/b24-production-qualification | 20 | 7ce1236 | this chapter, until its pull request merges (runbook `:1159`) |
| codex/reconstruct-b06-b16-history | 162 | e56d6c4 | the history-reconstruction branch, never merged; `HISTORY FABRICATED OR BACKDATED` names it (OD-221) |
| fix/assignment-queue-selection-reset | 1 | 32fa242 | corrective, unmerged |
| fix/b16-0-revoked-member-cold-import-timeout | 1 | 9335704 | corrective (a test timeout), unmerged |
| fix/b18-d-repair-reapply-after-undo | 2 | 635d9fd | corrective (re-apply after undo), unmerged |
| fix/b21-page-react-hooks-refs | 1 | 5dfae2b | corrective (`app/page.tsx`'s 14 eslint errors, 2.2), unmerged |

The local `integration/ai-control-plane-b16-0` (2.1) has no remote branch outside main.

### 4.5 Recorded for commit 2/2 (never answered here)

- **History.** Four pull requests merged 2026-09-07..09 hold commits whose author dates fall after their own merge commit: #4 (`b7bb6d6`,
  6 commits), #5 (`62ea4a6`, 23), #6 (`82ecbf8`, 4) and #7 (`804a08d`, 9), by up to 237 minutes - for example `2558259` (2026-09-10
  03:14:35 -0400, "B17 final gate recorded") is a parent of `804a08d` (2026-09-09 23:20:08 -0400). INFERRED: the committing clock wrote
  UTC wall time under a -0400 offset in that window (about four hours ahead). RECORDED for commit 2/2's `HISTORY FABRICATED OR
  BACKDATED` line, which reads main's history at the final SHA; not answered here.
- **eslint.** `app/page.tsx`'s 14 errors (2.2) stand until `5dfae2b` merges through its own pull request; CI adds no eslint step before.
- **`SECRETS EXPOSED`** and **`PROTECTED ORIGINAL MODIFIED`**: measured by commit 2/2 by the methods of 2.6.

### 4.6 Test-first record and gates

Every run went through the lock scripts (two workers), with no `DATABASE_URL`, no browser and no outside service; the logs stay outside the repository.

| run | what | result |
|---|---|---|
| `closeout-base-readers` | before any edit: the 50 suites outside this folder that read a file noted here (the B16.0, B19-B23 page, gate and closeout suites, `b11-5-capture-exactness`, `b14-4-ast-import-gates`, `b19-e-ci-job-scope`) | 50 files, 667 tests passed; exit 0 |
| `closeout-base-qualification` | before any edit: `app/lib/qualification/__tests__` | 50 files passed, 3 skipped; 521 tests passed, 15 skipped; exit 0 |
| `closeout-red-1` | cases 7 and 8 written, nothing else changed (`7ce1236`) | red: 7 and 8 (no section 4: no table under 4.7), 6 passed; exit 1 |
| the filter counterexample | a script over the tree, nothing written to the repository: the 32 drafted lines inserted in memory | with A1's and B3's old filter, A1's fourteen discovery rows and B3's later citations moved; with the new filter none; B24-F's numbering unmoved |
| `closeout-f-1` | the four B24-F suites after the notes and the page | 33 passed, 2 red: 4 (OD-5's status, OD-221's marker, OD-241's line - the lead's 4.9 texts) and 8 (4.7's six notes and 4.8's 32 lines); exit 1 |
| `closeout-sim-4` | the lead's application of 4.7, 4.8 and 4.9 simulated in memory (nothing written) | green: cases 4 and 8, B24-F's, A1's and B3's numberings, the defect ids, the commit bindings and the superseded-list sources |
| `closeout-break-run` | four planted breakages: a code note removed, a note on a line no row names, a discovery line drafted after the wrong base line, a row back to `not noted` | each caught by case 7; the three files restored by sha256 |
| `closeout-tsc-1`, `closeout-eslint-1` | tsc; eslint on the 13 changed TypeScript files | 0; 0 |
| the generators | all 28, twice, through the lock | 56 runs, exit 0; zero drift but `gen-demo-fixtures`' known CRLF rewrite of `app/lib/pcb/demo/fixtures.ts` (content identical; its LF bytes restored from HEAD, sha256 equal) |
| `closeout-after-readers` | the 50 reader suites again | 50 files, 667 tests passed; exit 0 |
| `closeout-after-qualification` | `app/lib/qualification/__tests__`, `b24-e-statements`, `b24-a1-environment-profile` and `b24-b3-scenario-map` among them | 49 files passed, 1 failed, 3 skipped; 521 tests passed, 2 red (`b24-f-registers` 4 and 8, waiting for the lead), 15 skipped; exit 1 |
| `closeout-secret-scan` | the tree secret scan | 4197 entries, 8 allowlisted lines; exit 0 |
| the counts | `current-system-map.md` regenerated, unchanged | census 168 / 165 / 3 / 0; tools 48 / 37 / 9 / 28; 107 action records; 32 migrations |
| `cfix-red-1` | the review round (2026-10-10): cases 9 and 10 written and case 7 strengthened (a whole-tree walk, the TypeScript parser's comment ranges, a sentence-boundary rule), nothing else changed | red: 7 (four notes inside a sentence), 9 (16 problems: the OD-221 amendment a four-line heading block, 2.3's hand-off unnoted, OD-5's two texts not held to the migration proof's section 3), 10 (five notes on lines their sources call still true or unchanged; every planted text caught); 4 and 8 waiting; 5 passed; exit 1 |
| `cfix-after-qualification` | `app/lib/qualification/__tests__` after the fixes, with case 7 declaring a 180 s budget and a yield | `b24-d1-threshold-census` 5 red: the budget and the `setImmediate` yield add two census rows; both dropped (case 7 runs in 0.44-0.52 s here, under lead lesson 14's 1.5 s), so the census is unchanged |
| `cfix-green-2` | `b24-f-registers` and `b24-d1-threshold-census` | 15 passed, 2 red (4 and 8, waiting for the lead); exit 1 |
| `cfix-break-1` | two planted breakages in real files: a closeout note in `app/lib/auth/route-handlers.ts`, which no row names, and the note of `app/api/parts/search/route.ts:19` moved into a string after `https://` | each caught by case 7 (the old scan read only the table's files and took any earlier `//` for a comment); both files restored, sha256 equal |
| `cfix-tsc-1`, `cfix-eslint-1` | tsc; eslint on the 9 changed TypeScript files | 0; 0 |
| `cfix-generators` | all 28 generators, twice | 56 runs, exit 0; zero drift but the known CRLF rewrite of `app/lib/pcb/demo/fixtures.ts` (content identical; LF bytes restored from HEAD, the tree then equal to the pre-run snapshot); counts unchanged |
| `cfix-after-readers` | the 50 reader suites again | 50 files, 667 tests passed; exit 0 |
| `cfix-secret-scan`, `cfix-sim-1` | the tree secret scan; the lead's application of 4.7-4.9 simulated in memory | 4197 entries, 8 allowlisted lines, exit 0; green |
| `cfix-final-qualification` | `app/lib/qualification/__tests__` on the final page | 49 files passed, 1 failed, 3 skipped; 523 tests passed, 2 red (`b24-f-registers` 4 and 8, waiting for the lead), 15 skipped; exit 1 |
| `cfix-final-tripwires` | `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements` on the final page | 3 files, 27 tests passed; exit 0 |

### 4.7 For the lead: the in-place notes in the lead's files

| path:line | note |
|---|---|
| `artifacts/ai-control-plane-b24/README.md:18` | [B24-closeout, 2026-10-10] superseded: B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2913` | [B24-closeout, 2026-10-10] superseded: B24-C2's record, artifacts/ai-control-plane-b24/observability-and-replay.md:752. |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1107` | [B24-closeout, 2026-10-10] superseded: B24-C2's record, artifacts/ai-control-plane-b24/retention-and-deletion.md:213. |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:110` | [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `artifacts/remaining-builder-program/OWNER_DECISIONS.md:113` | [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `artifacts/remaining-builder-program/EXECUTION_LEDGER.md:5280` | [B24-closeout, 2026-10-10] superseded: B24-D4's record, artifacts/remaining-builder-program/EXECUTION_LEDGER.md:5343. |

Append each note to its line after one space (its text verbatim); in `README.md:18`, inside the last cell, before the closing bar.
`OWNER_DECISIONS.md:1107` is the corrected row of 4.1. Nothing moves a line.

### 4.8 For the lead: the discovery lines

| after | line |
|---|---|
| `discovery.md:102` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:97 by B24-B3's record, artifacts/ai-control-plane-b24/scenario-map.md:407. |
| `discovery.md:209` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:205-209 by B24-A1's record, artifacts/ai-control-plane-b24/environments-and-deployment.md:488. |
| `discovery.md:237` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:235-237 by B24-A1's record, artifacts/ai-control-plane-b24/environments-and-deployment.md:488. |
| `discovery.md:329` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:322 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:334` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:330 by B24-B3's record, artifacts/ai-control-plane-b24/scenario-map.md:407. |
| `discovery.md:363` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:360 by B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338. |
| `discovery.md:388` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:385-386 by B24-C3's record, artifacts/ai-control-plane-b24/observability-and-replay.md:1048. |
| `discovery.md:401` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:400 by B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `discovery.md:423` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:418-419 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535; discovery.md:421-422 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535. |
| `discovery.md:430` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:426 by B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338. |
| `discovery.md:442` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:436 by B24-B3's record, artifacts/ai-control-plane-b24/scenario-map.md:407; discovery.md:437 by B24-E's record, artifacts/ai-control-plane-b24/qualification-matrix.md:329. |
| `discovery.md:453` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:451 by B24-B3's record, artifacts/ai-control-plane-b24/scenario-map.md:407. |
| `discovery.md:540` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:532 by B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `discovery.md:631` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:629 by B24-A1's record, artifacts/ai-control-plane-b24/environments-and-deployment.md:488. |
| `discovery.md:667` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:667 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:676` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:670 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:677` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:677 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:715` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:714 by B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338. |
| `discovery.md:763` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:760 by B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `discovery.md:770` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:767 by B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305; discovery.md:768 by B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338. |
| `discovery.md:798` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:795 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535; discovery.md:796-797 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535. |
| `discovery.md:807` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:804 by B24-E's record, artifacts/ai-control-plane-b24/qualification-matrix.md:329. |
| `discovery.md:814` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:811 by B24-E's record, artifacts/ai-control-plane-b24/qualification-matrix.md:329. |
| `discovery.md:888` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:887 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:924` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:923 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:940` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:940 by B24-B2's record, artifacts/ai-control-plane-b24/ci-admission.md:404. |
| `discovery.md:949` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:947 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535. |
| `discovery.md:992` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:972 by B24-C2's record, artifacts/ai-control-plane-b24/observability-and-replay.md:752; discovery.md:978 by B24-C2's record, artifacts/ai-control-plane-b24/observability-and-replay.md:752. |
| `discovery.md:1131` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:1131 by B24-E's record, artifacts/ai-control-plane-b24/qualification-matrix.md:329. |
| `discovery.md:1332` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:1304 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535. |
| `discovery.md:1418` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:1409 by B24-D3's record, artifacts/ai-control-plane-b24/accessibility.md:535. |
| `discovery.md:1487` | - [B24-closeout, 2026-10-10] superseded at 58c0834's numbering: discovery.md:1487 by B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |

Insert each line as one new line right after the discovery line that `after` names, at `58c0834`'s numbering (lines that start
`- [B24-F` or `- [B24-closeout` not counted): that is the last line of the block holding its statements (a table's last row, a bullet's
or a paragraph's last line), before any dated line already standing there.

### 4.9 For the lead: the OD texts, the discovery clauses, the ledger, the README row and PROGRAM_STATE.json

OD-5, in place: the Status cell of `OWNER_DECISIONS.md:11` (its last cell), `open (scheduled B16-B)`, becomes this text (no bar inside):

```text
closed [B24-closeout, 2026-10-10] (OD-221): B16-B's one supported mechanism (ddf1dc0, 2026-09-07: the runner with its own ledger, db:migrate, and 0027 and 0028 registered after the journal, which lists 0000-0026 by design; app/lib/db/migrations/manifest.ts:6-10, :15-23, :32-37; app/lib/db/__tests__/b16-b-migrations.test.ts:36), extended by reviewed registrations - 0029 by B19-D (2feaeee) and 0030 by B19-E (875da8f), both 2026-09-13, and 0031 by B24-A4 (72c1376, 2026-10-08); the runner applies all 32 through db:migrate and refuses checksum drift (app/lib/db/migrations/runner.ts:133; package.json lines 13-15, db:push refused); every migration applies on PGlite in CI (b16-b-migrations.test.ts:39, :119), with B24-A4's rollback and restore offline (artifacts/ai-control-plane-b24/database-migration-proof.md:22-37); the owner-authorised run of 2026-09-24 (RECORDED; database-migration-proof.md:39-48; EXECUTION_LEDGER.md:2490-2509; OD-191) applied the migrations of its day to a clean database of a non-isolated server and upgraded a second from 0000-0026 to the same fingerprint - whether 0029 and 0030 ran there is not recorded (INFERRED yes), and 0031 did not exist then: it has run on PGlite only, and its apply to a real server, like any apply to staging or production, stays BLOCKED-LIVE-QUALIFICATION (LB-14); the cell read open (scheduled B16-B) until this note
```

OD-19, in place: appended to `OWNER_DECISIONS.md:33` (the Question bullet), after one space:

```text
[B24-closeout, 2026-10-10] Corrected (OD-221; git log --format=%ae, read-only, at 7ce1236 with origin/main 57c3b29): the other address authored 65 of the program's commits, not 54 - 54 in B18's range (804a08d..5a59a1f) and 11 in B17's (82ecbf8..804a08d, 11 of its 14 non-merge commits) - from 2026-09-09 23:08:05 -0400 (040df94) to 2026-09-11 19:55:05 -0400 (e543cfe), and none since: every non-merge commit since 5a59a1f uses the approved address (131 of 131). The program's range is f7bf546^1..origin/main, every commit main gained from pull request #2 (f7bf546, 2026-08-28, the program's first merged pull request) on: 276 commits, 198 by the approved address (192 non-merge, 6 local merges), 65 by the other and 13 pull-request merge commits (#2-#14) authored by the GitHub account's noreply address (six of them since 5a59a1f, #9-#14). Main's history before the program holds seven more by the other address (2026-06-11, 2026-06-13). No commit is rewritten (OD-8); open-risks-and-owner-decisions.md section 4.3.
```

OD-221 amendment: one dated line, appended right after `OWNER_DECISIONS.md:3210` (OD-221's last bullet), as the lead applied OD-30's,
OD-195's and OD-220's amendments (lead decision D13: a dated line under the first heading, no new heading), so OD-241's heading stands
at `:3214`, where section 1 cites it (`b24-f-registers` 9 applies it in memory):

```text
- [B24-closeout, 2026-10-10] Closeout commit 1/2 applied the record half: of the superseded-statement table's 96 not-noted rows, 91 are noted - 48 in place by the closeout, six in place in the lead's files, 37 discovery rows nearby by 32 dated lines - and five stay not noted with the reason in place, their own sources calling the cited line still true or unchanged (B24-A1's two fail-closed auth headers; B24-C2's call record, orchestration store and trace store), so no superseded note mislabels them (open-risks-and-owner-decisions.md section 4; b24-f-registers 7, 8 and 10); one row's citation is corrected (OWNER_DECISIONS.md 1101-1103 to 1106-1107); B24-E's four tripwire finds carry the note (B21's unknowns page lines 155, 156 and 158, B18's line 12); OD-5 is closed in its Status cell (the mechanism offline; the 2026-09-24 run RECORDED, with 0031 not yet written then and its real-server apply BLOCKED-LIVE-QUALIFICATION, LB-14); OD-19's count is corrected in place (65 commits under the other address, 11 in B17's range and 54 in B18's; 13 pull-request merges, #2-#14, carry the GitHub noreply author); the OD list cites OD-220, OD-221, OD-240 and OD-241 at their heading lines; the A1 and B3 discovery filters skip the closeout's dated lines (a reviewed pin move). Commit 2/2 measures at the final main SHA: SECRETS EXPOSED (B24-A2's scanner over main's history), PROTECTED ORIGINAL MODIFIED (a read-only listing with modification times of the protected original checkout), HISTORY FABRICATED OR BACKDATED (main's history, codex/reconstruct-b06-b16-history named and unmerged; pull requests #4-#7 hold commits dated up to 237 minutes after their merge, recorded in section 4.5), the unmerged corrective branches (fix/assignment-queue-selection-reset, fix/b16-0-revoked-member-cold-import-timeout, fix/b18-d-repair-reapply-after-undo, fix/b21-page-react-hooks-refs), and eslint (app/page.tsx's 14 errors stand until 5dfae2b merges through its own pull request; no CI eslint step before then).
```

The discovery clauses, each one line (beside 4.8's 32): after the line that starts `- [B24-F, 2026-10-10] D24-38:`, after the line that
starts `- [B24-F, 2026-10-10] D24-40:`, and at the end of section 10:

```text
- [B24-closeout, 2026-10-10] D24-38: the closeout's half, commit 1/2: every stale line of the superseded-statement table (open-risks-and-owner-decisions.md section 3.2) is handled - 48 noted in place by the closeout, six in place in the lead's files, 37 discovery rows by dated lines, and five left not noted with the reason in place because their own sources call the line still true or unchanged - and no bare not-noted row remains (b24-f-registers 7, 8 and 10); the register's row is re-read at commit 2/2.
- [B24-closeout, 2026-10-10] D24-40: the closeout's record half, commit 1/2: OD-5 closed (the mechanism offline; the 2026-09-24 run RECORDED, 0031 not yet written then, its real-server apply BLOCKED-LIVE-QUALIFICATION, LB-14) and OD-19 corrected (65 commits under the other address; 13 pull-request merges carry the GitHub noreply author), the OD list citing OD-220, OD-221, OD-240 and OD-241 at their heading lines; the three integrity measurements stay commit 2/2's (open-risks-and-owner-decisions.md section 4).
- [B24-closeout, 2026-10-10] Closeout commit 1/2 landed the superseding notes and OD-221's record corrections (D5; D24-38's and D24-40's closeout halves; no new defect, no LB row, no OD entry): of 96 not-noted rows, 91 noted (48 in place, six in the lead's files, 37 discovery rows nearby) and five left not noted with the reason in place (their sources call the line still true or unchanged), one citation corrected, B24-E's four finds noted, OD-5 closed, OD-19 corrected, and the A1 and B3 discovery filters skip the closeout's dated lines (a reviewed pin move); suites b24-f-registers 7 to 10; open-risks-and-owner-decisions.md section 4.
```

The ledger section, appended:

```text
### B24-closeout - commit 1/2: the superseding notes and OD-221's record corrections (2026-10-10 local; increment workflow + lead; this commit)

- **Delivered** (D5; D24-38's and D24-40's closeout halves; no new defect, no LB row, no OD entry; `open-risks-and-owner-decisions.md` section 4).
  - Of the superseded-statement table's 96 not-noted rows, 91 are noted: 48 in place by the closeout in 30 files (five code files - four inside an existing comment, one trailing comment on a test's it( line - and 25 pages: twelve table rows inside their last cell, 31 lines appended), each with the closeout's dated note naming the increment's record and its list's line, on a code line inside a comment the TypeScript parser reads as one and at a sentence or clause end; six in place in the lead's files and 37 discovery rows nearby by 32 dated lines, from the page's drafts (4.7, 4.8), applied by the lead in this commit. Five stay not noted with the reason in place, because their own sources call the cited line still true or unchanged (B24-A1's expected-origin.ts and trusted-request-context.ts headers; B24-C2's llm-call-record.ts, orchestration store.ts and run-trace-store.ts): those five files are byte-identical to 7ce1236. The eight frozen rows stay recorded only.
  - One row's citation corrected (OD-111's purge statement: OWNER_DECISIONS.md 1101-1103 to 1106-1107, read at 600d1ba, 58c0834 and 7ce1236).
  - B24-E's four tripwire finds carry the note (B21's unknowns page lines 155, 156 and 158; B18's line 12).
  - OD-5 closed in its Status cell: B16-B's mechanism (ddf1dc0 registered 0027 and 0028; B19-D 0029 and B19-E 0030, 2026-09-13; B24-A4 0031, 2026-10-08) CONFIRMED offline; the 2026-09-24 run RECORDED as the migration proof's section 3 holds it (the migrations of its day on a clean database, 0029 and 0030 INFERRED, 0031 not yet written), and 0031's real-server apply BLOCKED-LIVE-QUALIFICATION (LB-14). OD-19's count corrected in place (65 commits under the other address, 11 in B17's range and 54 in B18's, 2026-09-09 to 2026-09-11; 13 pull-request merges, #2-#14, carry the GitHub noreply author; the program's range f7bf546^1..origin/main, 276 commits); the OD list cites OD-220, OD-221, OD-240 and OD-241 at their heading lines; OD-221 amended by one dated line under its heading (D13).
  - Recorded for commit 2/2: pull requests #4-#7 hold commits dated up to 237 minutes after their merge (INFERRED a clock-label skew), and the unmerged branches at 7ce1236.
- **Test-first.** closeout-red-1: b24-f-registers 7 and 8 red on 7ce1236 with the cases written, 6 passed, exit 1. The filter counterexample: with the 32 drafted lines inserted in memory, A1's fourteen discovery rows and B3's later citations moved; after the pin move none did. closeout-break-run: four planted breakages, each caught by case 7, restored by sha256.
- **Review round** (2026-10-10; correctness-1, correctness-2, correctness-3, correctness-5, security-1, security-2, security-3). cfix-red-1: cases 9 and 10 written and case 7 strengthened (a whole-tree walk, the TypeScript parser's comment ranges, a sentence-boundary rule) on the closeout's tree: red - 7 (four notes splitting a sentence), 9 (16 problems: the OD-221 amendment a four-line heading block; 2.3's hand-off unnoted; OD-5's two texts not held to the proof's section 3 - the run's migrations and the increments that registered 0029-0031), 10 (five notes on lines their own sources call still true or unchanged); the planted texts of case 10 all caught. Fixed: the amendment one dated line (OD-241 cited at :3214); 2.3 noted; OD-5's texts against the proof; five rows not noted with the reason and their files restored to 7ce1236's bytes; two notes moved to a sentence end on their line. cfix-green-2: 7, 9 and 10 green (4 and 8 wait for the lead); case 7's whole-tree walk takes 0.44-0.52 s here, under lesson 14's 1.5 s, so it declares no budget and the threshold census is unchanged (a first try with a 180 s budget and a yield turned b24-d1-threshold-census 5 red, cfix-after-qualification). cfix-break-1: two planted breakages in real files - a closeout note in app/lib/auth/route-handlers.ts, which no row names, and the note of app/api/parts/search/route.ts:19 moved into a string after https:// - each caught by case 7 (the old scan read only the table's files and took any earlier // for a comment); both files restored, sha256 equal.
- **Pin moves** (each in place, dated): b24-a1-environment-profile.test.ts:394 and b24-b3-scenario-map.test.ts:267 - the discovery filters skip the closeout's dated lines as B24-F's AFTER_BASE_LINE does; the lead's own dated lines stay counted. b24-f-registers 6 admits the task's `not noted (<reason>)` state, which case 10 confines to the five rows.
- **Gates** (all through the lock; no DATABASE_URL, no browser):
  - The 50 reader suites outside the qualification folder: 667 passed before (closeout-after-readers) and after the review round (cfix-after-readers).
  - The qualification folder (cfix-final-qualification): 523 passed, 15 skipped, 2 red - b24-f-registers 4 and 8, which wait for this commit's OD texts, notes and discovery lines (cfix-sim-1 applies the lead's 4.7-4.9 in memory: green; case 9 runs case 4's check on 4.9's three OD texts applied in memory: green).
  - b24-e-statements and the B21, B22 and B23 closeout tripwires green on the final page; tsc 0; eslint 0 on the 9 changed TypeScript files.
  - All 28 generators twice: 56 runs, exit 0, zero drift but gen-demo-fixtures' known CRLF rewrite (content identical, LF bytes restored from HEAD; the tree then equal to the pre-run snapshot).
  - The tree secret scan: exit 0 (4197 entries, 8 allowlisted lines).
- **Counts.** Census 168 / 165 / 3 / 0; tools 48 / 37 / 9 / 28; 107 action records; 32 migrations - unchanged.
- **Stop conditions.** None hit: five of 96 rows stay not noted with their reason (under a quarter); no note changed a generated output; every tripwire green.
```

The README row, appended to the checkpoint table:

```text
| B24-closeout (commit 1/2): the superseding notes and OD-221's record corrections (D5; D24-38's and D24-40's closeout halves; OD-221 amended; no new defect, no LB row, no OD entry) | `open-risks-and-owner-decisions.md` sections 1, 2.3, 3 and 4; in place, the 48 noted lines of 30 files (5 code files, 25 pages); test `b24-f-registers` 7 to 10; pin moves `app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts:394`, `app/lib/qualification/__tests__/b24-b3-scenario-map.test.ts:267` | done 2026-10-10 offline: of 96 not-noted rows, 91 noted (48 in place, six drafted for the lead's files, 37 discovery rows by 32 drafted lines) and five left not noted with the reason (their sources call the line still true or unchanged); OD-5 closed (the 2026-09-24 run RECORDED, 0031's real-server apply BLOCKED, LB-14) and OD-19 corrected (65 and 13), the four OD lines cited; census 168 / 165 / 3 / 0, counts 48 / 37 / 9 / 28, 107 action records, 32 migrations; integrity lines commit 2/2's |
```

`PROGRAM_STATE.json`'s `nextAction`:

```text
the closeout's commit 2/2 (the test-and-validation report, the unknowns and owner decisions, the final verdict's run-measured scopes and final SHA, the three integrity measurements at the final main SHA), then the chapter PR merged normally after green CI, then the final program report
```
