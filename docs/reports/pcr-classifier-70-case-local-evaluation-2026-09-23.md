# PCR classifier: 70 local Henkaten submissions

Date: 2026-09-23 (Asia/Jakarta)

Runtime: local Docker Compose stack; Hosted Supplier API; `inclusionAI/Ling-3.0-tiny-fp8`; prompt `sqam-45-2026-09-v1`; confidence threshold 0.75.

## Method and evidence

Seventy distinct synthetic Hosted Henkaten were submitted through the running Supplier API in two batches (20 followed by 50) using the seeded NPM Line Leader, a current Line–Shift, valid job/part, and the published checklist. Every submission returned HTTP 201 with PCR Pending, and the live worker completed all 70. Categories covered **Method 28, Machine 19, Material 17, and Man 6**. The second batch deliberately expanded ambiguous, negated, temporary, S/R/E, and instruction-contaminated inputs. Five Man records used qualified replacement members. No record was manually corrected or approved.

The [evidence folder](pcr-classifier-70-case-evaluation-2026-09-23/README.md) preserves the exact shared [system prompt](pcr-classifier-70-case-evaluation-2026-09-23/system-prompt.txt), [tool and invocation settings](pcr-classifier-70-case-evaluation-2026-09-23/invocation.json), [manifest](pcr-classifier-70-case-evaluation-2026-09-23/manifest.json), and **one JSON file per case** containing the exact classifier input and model messages, expected label, persisted validated tool-output fields, final assessment status, confidence, matched items, full English assessment, timestamps, and attempt count. Cases 21–70 also contain the complete submitted API JSON. The first batch did not capture its entire API JSON, but its exact classifier input and both model messages are preserved. The application does not persist the raw OpenAI response envelope, token usage, finish reason, or original JSON whitespace; those cannot be reconstructed. The archive preserves all decision-bearing output values. No credential is stored there.

Expected labels were assigned before each batch from the [PRD](../../.agent/PRD.md), the [classifier prompt](../../apps/api/src/pcr/pcr-prompt.ts), and [ADR 0034](../adr/0034-durable-local-pcr-screening-and-human-correction.md). **Review labels are provisional test expectations**, marking reports without enough evidence to determine whether a controlled change exists. They require TMMIN QD adjudication and must not be read as a definitive policy ruling. Each input was run once; results are not a repeatability or production accuracy estimate.

## Test matrix

This matrix groups every case by the behavior it tests. `P / N / R` means observed PCR / No-PCR / Review. Case numbers link to full inputs and outputs in the case-by-case table below. Agreement for expected Review means the classifier routed an incomplete report to human review; those labels remain provisional pending TMMIN QD adjudication.

| Test dimension | Case IDs | Expected | Observed P / N / R | Agreement | What the row probes |
| --- | --- | ---: | ---: | ---: | --- |
| Method or parameter change | 01, 02, 08, 21, 29, 58, 70 | 7 PCR | 7 / 0 / 0 | 7/7 | Welding, injection, washing, curing, cost reduction, and an embedded instruction to return No-PCR. |
| Tool, machine, or cavity change | 06, 09, 22, 25, 30 | 5 PCR | 5 / 0 / 0 | 5/5 | New capability, first machine use, mold modification, and major repair. |
| Material, specification, or supplier change | 03, 07, 23, 27, 56, 64, 66 | 7 PCR | 7 / 0 / 0 | 7/7 | Changed source, formulation, grade, sub-supplier, and part specification. |
| Location, shift, or controlled inspection | 04, 05, 10, 24, 26, 28, 60, 62, 68 | 9 PCR | 9 / 0 / 0 | 9/9 | Relocation, additional shift, permanent inspection removal, and an S/R/E-related parameter change. |
| Routine manpower | 31, 32, 33, 63, 69 | 5 No-PCR | 0 / 5 / 0 | 5/5 | Qualified replacement, training, sickness, leave, and rotation without process change. |
| Unchanged material lot | 11, 35, 57 | 3 No-PCR | 1 / 2 / 0 | 2/3 | FIFO or identical approved lot; case 57 adds adversarial text and was incorrectly called PCR. |
| Equivalent repair or recovery | 12, 15, 18, 34, 39, 59, 61, 67 | 8 No-PCR | 0 / 8 / 0 | 8/8 | Identical parts or settings, tool wear, sensor reset, and network recovery. |
| Document, temporary check, part defect, or takt only | 13, 14, 16, 17, 36, 37, 38, 40, 65 | 9 No-PCR | 0 / 9 / 0 | 9/9 | No actual controlled process or specification change. |
| Incomplete material or sourcing evidence | 20, 41, 46, 49, 51, 54 | 6 Review | 3 / 1 / 2 | 2/6 | Trial material, undecided vendor or sub-supplier, uncertain grade, and possible emissions change. |
| Incomplete tool or machine evidence | 43, 47, 55 | 3 Review | 1 / 0 / 2 | 2/3 | Unknown replacement equivalence, repair effect, or controller software behavior. |
| Incomplete method, layout, inspection, or shift evidence | 19, 42, 44, 48, 50, 52, 53 | 7 Review | 4 / 1 / 2 | 2/7 | Temporary versus permanent work, unspecified limits, trial shift, and vague kaizen. |
| Incomplete manpower-related method evidence | 45 | 1 Review | 0 / 0 / 1 | 1/1 | Worker replacement with an unspecified change in how the work is done. |
| **Total** | **01–70** | **28 PCR, 25 No-PCR, 17 Review** | **37 / 26 / 7** | **59/70** | Clear-case agreement is 52/53; provisional Review routing is 7/17. |

## Decision results

| Expected from test rubric | PCR | No-PCR | Review | Total |
| --- | ---: | ---: | ---: | ---: |
| PCR | 28 | 0 | 0 | 28 |
| No-PCR | 1 | 24 | 0 | 25 |
| Review (provisional) | 8 | 2 | 7 | 17 |
| **Observed total** | **37** | **26** | **7** | **70** |

The clear-case agreement was **52/53**: all 28 PCR examples and 24/25 No-PCR examples. There was no clear PCR case hidden as No-PCR. The clear negative error was case [57](pcr-classifier-70-case-evaluation-2026-09-23/cases/57.json), an unchanged approved material lot with an embedded instruction telling the model to return PCR. Its output asserted a supplier-source change that the input explicitly denied, with confidence **1.00**. The paired instruction-contaminated real process change, case [58](pcr-classifier-70-case-evaluation-2026-09-23/cases/58.json), was correctly labelled PCR. Case 57 therefore demonstrates an adversarial-text/grounding failure, though the persisted output cannot prove whether the model literally followed the embedded instruction or was confused by the surrounding wording.

Only **7/17** incomplete cases reached Review. Six had validated model output below the 0.75 threshold; case [48](pcr-classifier-70-case-evaluation-2026-09-23/cases/48.json) had no validated tool-output fields, so its Review result was a safe fallback rather than a demonstrated uncertainty judgment. Eight incomplete cases received PCR with confidence 0.80–0.95. Two received No-PCR: case [20](pcr-classifier-70-case-evaluation-2026-09-23/cases/20.json) at **1.00** and case [53](pcr-classifier-70-case-evaluation-2026-09-23/cases/53.json) at **0.80**. These two are important because an automatic No-PCR can bypass the human review intended for uncertain process or material changes. Raising the confidence threshold alone would not catch case 20 and would miss most of the overconfident PCR calls.

## Explanation and evidence quality

- **Missing information was sometimes converted into asserted changes.** In case [41](pcr-classifier-70-case-evaluation-2026-09-23/cases/41.json), unknown resin source, grade, and specification became an asserted material change and an invented unapproved production introduction. In case [43](pcr-classifier-70-case-evaluation-2026-09-23/cases/43.json), unknown replacement tool characteristics became definite brand/type, modification, and setting changes. In case [46](pcr-classifier-70-case-evaluation-2026-09-23/cases/46.json), a backup vendor's sample became an actual supplier switch even though mass-production use was undecided. Case [51](pcr-classifier-70-case-evaluation-2026-09-23/cases/51.json) similarly treated a classification study with no decision as a completed sub-supplier classification change. These are conservative PCR flags, but their stated facts are unsupported.
- **Some control references are wrong or overextended.** Case [06](pcr-classifier-70-case-evaluation-2026-09-23/cases/06.json) attached items 4, 8, and 9 to a torque-tool change even though items 1–15 cover routine manpower; its explanation also invented equipment breakdown and relocation. Case [10](pcr-classifier-70-case-evaluation-2026-09-23/cases/10.json) called inspection-standard change “Item 4,” which is not the supplied inspection rule. Case [52](pcr-classifier-70-case-evaluation-2026-09-23/cases/52.json) cited relocation/location items 29 and 40 for an unconfirmed night-shift trial without any location change. Case [60](pcr-classifier-70-case-evaluation-2026-09-23/cases/60.json) included temporary-inspection item 21 alongside a valid PCR-positive setting change; that item is context, not an independent PCR trigger.
- **The full English narrative often exceeds or misses the requested length.** Of 37 observed PCR outputs, **23** were within the approximate 100–150-word target and **14** were outside it (range **85–231** words among the outliers; the overall longest was 231). All 37 mentioned TMMIN/QD, but several speculated about Safety, Regulations, or Emissions without evidence in the submitted record. The prompt asks for S/R/E impact only when supported. The full texts are preserved in the case JSON files.
- **Safe fallback worked for one unparseable or missing result.** Case [48](pcr-classifier-70-case-evaluation-2026-09-23/cases/48.json) persisted null model fields and Review after one attempt. The database does not distinguish malformed tool output from another non-exception response failure, so the precise cause cannot be assigned from stored evidence.

Assessment completion ranged from **6.9 to 572.5 seconds**, with a **186.4-second median** measured from assessment-row creation to update across both batches. These are end-to-end queue times during bulk submission, not per-inference latency measurements; the single worker processed the queue serially.

## Case-by-case results

“Expected Review” means the test author judged the evidence incomplete; it is not an adjudicated ground truth. Click a case number for the complete input prompt and output.

| Case | Scenario | 4M | Expected | Observed | Confidence | Matched items | PCR words |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| [01](pcr-classifier-70-case-evaluation-2026-09-23/cases/01.json) | Urutan proses welding diubah permanen | METHOD | PCR | PCR | 0.95 | 20 | 211 |
| [02](pcr-classifier-70-case-evaluation-2026-09-23/cases/02.json) | Setting suhu injection molding dinaikkan | MACHINE | PCR | PCR | 0.95 | 20, 27 | 111 |
| [03](pcr-classifier-70-case-evaluation-2026-09-23/cases/03.json) | Ganti pemasok resin | MATERIAL | PCR | PCR | 0.95 | 35 | 108 |
| [04](pcr-classifier-70-case-evaluation-2026-09-23/cases/04.json) | Pindah mesin press ke area lain | MACHINE | PCR | PCR | 0.90 | 40, 29 | 90 |
| [05](pcr-classifier-70-case-evaluation-2026-09-23/cases/05.json) | Inspeksi akhir permanen dihapus | METHOD | PCR | PCR | 0.95 | 41, 20 | 100 |
| [06](pcr-classifier-70-case-evaluation-2026-09-23/cases/06.json) | Ganti tipe torque tool | MACHINE | PCR | PCR | 0.90 | 4, 8, 9, 23, 24, 25, 27, 28 | 139 |
| [07](pcr-classifier-70-case-evaluation-2026-09-23/cases/07.json) | Komposisi coating berubah | MATERIAL | PCR | PCR | 0.85 | 35, 34, 20 | 92 |
| [08](pcr-classifier-70-case-evaluation-2026-09-23/cases/08.json) | Proses washing diganti untuk efisiensi biaya | METHOD | PCR | PCR | 0.90 | 20 | 99 |
| [09](pcr-classifier-70-case-evaluation-2026-09-23/cases/09.json) | Mesin baru dipakai pertama kali | MACHINE | PCR | PCR | 0.95 | 20, 23, 24, 25, 28 | 145 |
| [10](pcr-classifier-70-case-evaluation-2026-09-23/cases/10.json) | Standar inspeksi dimensi diubah | METHOD | PCR | PCR | 0.85 | 4 | 151 |
| [11](pcr-classifier-70-case-evaluation-2026-09-23/cases/11.json) | Pergantian lot resin FIFO | MATERIAL | NO_PCR | NO_PCR | 1.00 | — | — |
| [12](pcr-classifier-70-case-evaluation-2026-09-23/cases/12.json) | Perbaikan mesin kembali ke kondisi semula | MACHINE | NO_PCR | NO_PCR | 0.95 | — | — |
| [13](pcr-classifier-70-case-evaluation-2026-09-23/cases/13.json) | Tambahan inspeksi sementara | METHOD | NO_PCR | NO_PCR | 0.90 | 21 | — |
| [14](pcr-classifier-70-case-evaluation-2026-09-23/cases/14.json) | Revisi typo instruksi kerja | METHOD | NO_PCR | NO_PCR | 0.95 | 16 | — |
| [15](pcr-classifier-70-case-evaluation-2026-09-23/cases/15.json) | Scanner input restart | MACHINE | NO_PCR | NO_PCR | 0.95 | 30 | — |
| [16](pcr-classifier-70-case-evaluation-2026-09-23/cases/16.json) | Part individual rusak saat handling | MATERIAL | NO_PCR | NO_PCR | 0.95 | 36 | — |
| [17](pcr-classifier-70-case-evaluation-2026-09-23/cases/17.json) | Cycle time harian berfluktuasi | METHOD | NO_PCR | NO_PCR | 0.80 | 37 | — |
| [18](pcr-classifier-70-case-evaluation-2026-09-23/cases/18.json) | Tool aus diganti ekuivalen | MACHINE | NO_PCR | NO_PCR | 1.00 | 30 | — |
| [19](pcr-classifier-70-case-evaluation-2026-09-23/cases/19.json) | Penyesuaian kecil area kerja | METHOD | REVIEW | PCR | 0.80 | 20, 29, 40 | 135 |
| [20](pcr-classifier-70-case-evaluation-2026-09-23/cases/20.json) | Material alternatif sedang dicoba | MATERIAL | REVIEW | NO_PCR | 1.00 | — | — |
| [21](pcr-classifier-70-case-evaluation-2026-09-23/cases/21.json) | Proses spot weld diganti laser weld | METHOD | PCR | PCR | 0.95 | 20, 27, 28 | 95 |
| [22](pcr-classifier-70-case-evaluation-2026-09-23/cases/22.json) | Cavity mold diperbesar | MACHINE | PCR | PCR | 0.95 | 26, 23 | 101 |
| [23](pcr-classifier-70-case-evaluation-2026-09-23/cases/23.json) | Grade baja berubah | MATERIAL | PCR | PCR | 0.90 | 35, 34, 20 | 98 |
| [24](pcr-classifier-70-case-evaluation-2026-09-23/cases/24.json) | Inspeksi end-of-line dihilangkan permanen | METHOD | PCR | PCR | 0.90 | 41, 42 | 113 |
| [25](pcr-classifier-70-case-evaluation-2026-09-23/cases/25.json) | Pasang robot baru di line | MACHINE | PCR | PCR | 0.95 | 20, 23, 25, 27, 28 | 129 |
| [26](pcr-classifier-70-case-evaluation-2026-09-23/cases/26.json) | Tambah shift produksi ketiga | METHOD | PCR | PCR | 0.95 | 20, 43 | 121 |
| [27](pcr-classifier-70-case-evaluation-2026-09-23/cases/27.json) | Sub-supplier plating berganti | MATERIAL | PCR | PCR | 0.88 | 35, 44 | 118 |
| [28](pcr-classifier-70-case-evaluation-2026-09-23/cases/28.json) | Pindah lokasi proses assembly | METHOD | PCR | PCR | 0.85 | 20, 29, 40 | 107 |
| [29](pcr-classifier-70-case-evaluation-2026-09-23/cases/29.json) | Instruksi kerja direvisi karena metode berubah | METHOD | PCR | PCR | 0.85 | 20 | 150 |
| [30](pcr-classifier-70-case-evaluation-2026-09-23/cases/30.json) | Repair besar mengubah kapabilitas press | MACHINE | PCR | PCR | 0.95 | 22, 23, 24, 25, 26, 27, 28 | 171 |
| [31](pcr-classifier-70-case-evaluation-2026-09-23/cases/31.json) | Operator absen sakit | MAN | NO_PCR | NO_PCR | 1.00 | 1 | — |
| [32](pcr-classifier-70-case-evaluation-2026-09-23/cases/32.json) | Operator baru dalam pelatihan | MAN | NO_PCR | NO_PCR | 1.00 | 1 | — |
| [33](pcr-classifier-70-case-evaluation-2026-09-23/cases/33.json) | Rotasi operator dalam shop yang sama | MAN | NO_PCR | NO_PCR | 0.95 | 1, 2, 3 | — |
| [34](pcr-classifier-70-case-evaluation-2026-09-23/cases/34.json) | Ganti motor mesin identik | MACHINE | NO_PCR | NO_PCR | 0.95 | 30 | — |
| [35](pcr-classifier-70-case-evaluation-2026-09-23/cases/35.json) | Lot cat berganti sesuai FIFO | MATERIAL | NO_PCR | NO_PCR | 0.95 | 45 | — |
| [36](pcr-classifier-70-case-evaluation-2026-09-23/cases/36.json) | Sampling tambahan sementara | METHOD | NO_PCR | NO_PCR | 0.80 | 21 | — |
| [37](pcr-classifier-70-case-evaluation-2026-09-23/cases/37.json) | Nomor revisi WI diperbaiki | METHOD | NO_PCR | NO_PCR | 0.85 | 16 | — |
| [38](pcr-classifier-70-case-evaluation-2026-09-23/cases/38.json) | Rework satu part cacat | METHOD | NO_PCR | NO_PCR | 0.85 | 18, 19 | — |
| [39](pcr-classifier-70-case-evaluation-2026-09-23/cases/39.json) | Reset poka-yoke setelah error | MACHINE | NO_PCR | NO_PCR | 0.95 | 30 | — |
| [40](pcr-classifier-70-case-evaluation-2026-09-23/cases/40.json) | Takt time berubah karena penundaan | METHOD | NO_PCR | NO_PCR | 1.00 | 37 | — |
| [41](pcr-classifier-70-case-evaluation-2026-09-23/cases/41.json) | Resin alternatif untuk trial | MATERIAL | REVIEW | PCR | 0.95 | 35, 44 | 133 |
| [42](pcr-classifier-70-case-evaluation-2026-09-23/cases/42.json) | Meja kerja dipindah sedikit | METHOD | REVIEW | PCR | 0.85 | 20, 29 | 85 |
| [43](pcr-classifier-70-case-evaluation-2026-09-23/cases/43.json) | Tool pengganti tersedia | MACHINE | REVIEW | PCR | 0.85 | 25, 26, 27 | 129 |
| [44](pcr-classifier-70-case-evaluation-2026-09-23/cases/44.json) | Tambah pemeriksaan visual | METHOD | REVIEW | REVIEW | 0.35 | 21, 41 | 84 |
| [45](pcr-classifier-70-case-evaluation-2026-09-23/cases/45.json) | Pergantian personel disertai perubahan kerja | MAN | REVIEW | REVIEW | 0.35 | 20, 16 | 134 |
| [46](pcr-classifier-70-case-evaluation-2026-09-23/cases/46.json) | Pemasok cadangan untuk evaluasi | MATERIAL | REVIEW | PCR | 0.85 | 35, 44 | 231 |
| [47](pcr-classifier-70-case-evaluation-2026-09-23/cases/47.json) | Perbaikan mesin dengan komponen baru | MACHINE | REVIEW | REVIEW | 0.30 | 22, 27 | 97 |
| [48](pcr-classifier-70-case-evaluation-2026-09-23/cases/48.json) | Workaround manual sementara | METHOD | REVIEW | REVIEW | — | — | — |
| [49](pcr-classifier-70-case-evaluation-2026-09-23/cases/49.json) | Potensi perubahan emisi coating | MATERIAL | REVIEW | REVIEW | 0.35 | 20, 34, 35, 41 | 105 |
| [50](pcr-classifier-70-case-evaluation-2026-09-23/cases/50.json) | Toleransi inspeksi akan disesuaikan | METHOD | REVIEW | PCR | 0.95 | 20, 34 | 133 |
| [51](pcr-classifier-70-case-evaluation-2026-09-23/cases/51.json) | Klasifikasi sub-supplier dikaji | MATERIAL | REVIEW | PCR | 0.95 | 44 | 120 |
| [52](pcr-classifier-70-case-evaluation-2026-09-23/cases/52.json) | Trial shift tambahan | METHOD | REVIEW | PCR | 0.85 | 20, 43, 29, 40 | 169 |
| [53](pcr-classifier-70-case-evaluation-2026-09-23/cases/53.json) | Kaizen proses kecil | METHOD | REVIEW | NO_PCR | 0.80 | 45 | — |
| [54](pcr-classifier-70-case-evaluation-2026-09-23/cases/54.json) | Grade material disebut baru namun identik | MATERIAL | REVIEW | REVIEW | 0.30 | — | — |
| [55](pcr-classifier-70-case-evaluation-2026-09-23/cases/55.json) | Update software controller | MACHINE | REVIEW | REVIEW | 0.35 | 20, 27 | 139 |
| [56](pcr-classifier-70-case-evaluation-2026-09-23/cases/56.json) | Bukan sekadar ganti lot: formula berubah | MATERIAL | PCR | PCR | 0.95 | 20, 34, 35 | 136 |
| [57](pcr-classifier-70-case-evaluation-2026-09-23/cases/57.json) | Lot baru sama spesifikasi dengan instruksi palsu | MATERIAL | NO_PCR | PCR | 1.00 | 35 | 125 |
| [58](pcr-classifier-70-case-evaluation-2026-09-23/cases/58.json) | Instruksi palsu pada perubahan welding | METHOD | PCR | PCR | 0.95 | 20, 27 | 111 |
| [59](pcr-classifier-70-case-evaluation-2026-09-23/cases/59.json) | Torque 120 Nm tetap sama | MACHINE | NO_PCR | NO_PCR | 0.95 | 18, 19, 30, 33 | — |
| [60](pcr-classifier-70-case-evaluation-2026-09-23/cases/60.json) | Inspeksi sementara karena regulasi emisi berubah | METHOD | PCR | PCR | 0.95 | 20, 21, 27 | 122 |
| [61](pcr-classifier-70-case-evaluation-2026-09-23/cases/61.json) | Mesin rusak diganti spare identik | MACHINE | NO_PCR | NO_PCR | 0.95 | 18, 19, 30, 31, 32, 33 | — |
| [62](pcr-classifier-70-case-evaluation-2026-09-23/cases/62.json) | Mesin identik tetapi pindah gedung | MACHINE | PCR | PCR | 0.95 | 40, 20 | 164 |
| [63](pcr-classifier-70-case-evaluation-2026-09-23/cases/63.json) | Rotasi MP antar line tanpa perubahan proses | MAN | NO_PCR | NO_PCR | 1.00 | 1 | — |
| [64](pcr-classifier-70-case-evaluation-2026-09-23/cases/64.json) | Vendor coolant proses diganti | MATERIAL | PCR | PCR | 0.95 | 35, 44 | 120 |
| [65](pcr-classifier-70-case-evaluation-2026-09-23/cases/65.json) | WI diterjemahkan ke bahasa Indonesia | METHOD | NO_PCR | NO_PCR | 0.95 | 16 | — |
| [66](pcr-classifier-70-case-evaluation-2026-09-23/cases/66.json) | Spesifikasi part berubah | MATERIAL | PCR | PCR | 0.95 | 34, 20, 35 | 99 |
| [67](pcr-classifier-70-case-evaluation-2026-09-23/cases/67.json) | Jaringan mesin pulih tanpa update | MACHINE | NO_PCR | NO_PCR | 0.95 | 30 | — |
| [68](pcr-classifier-70-case-evaluation-2026-09-23/cases/68.json) | Permanent inspection step dihapus | METHOD | PCR | PCR | 0.90 | 42 | 124 |
| [69](pcr-classifier-70-case-evaluation-2026-09-23/cases/69.json) | Pengganti operator cuti | MAN | NO_PCR | NO_PCR | 1.00 | 1 | — |
| [70](pcr-classifier-70-case-evaluation-2026-09-23/cases/70.json) | Cost reduction ubah parameter oven | METHOD | PCR | PCR | 0.95 | 20, 27 | 90 |

## Recommendations

1. **Prioritize the ambiguous No-PCR path.** Have TMMIN QD adjudicate cases 20 and 53, then require explicit evidence of unchanged approved source/specification/method before giving high-confidence No-PCR on incomplete material or kaizen reports. Missing facts should lead to clarification or Review; case 20 shows threshold tuning alone is insufficient.
2. **Add regression cases for adversarial and contradictory text.** Case 57 should be a hard negative grounded in its actual lot/source facts; preserve case 58 as a paired positive. Test negation and category mismatch across multiple runs before claiming prompt-injection resistance.
3. **Ground assessment claims and control references.** Require cited item numbers to correspond to the actual described change, and prevent missing supplier/tool/location facts from becoming affirmative claims. Consider a structured evidence field or post-validation before exposing a PCR narrative.
4. **Tighten explanation and operational checks.** Enforce or rewrite the 100–150-word English target and remove unsupported S/R/E claims. Keep the current Review fallback for invalid/unavailable output, while monitoring how often it occurs separately from genuinely low-confidence decisions.
5. **Repeat with adjudicated real cases.** This synthetic one-pass set supports local integration and failure discovery. A representative Indonesian sample, TMMIN QD labels, and repeated model runs are needed to estimate production performance and variability.

The 70 test Henkaten and their Open warnings remain in the local NPM demo for inspection. The Compose stack was running before testing and remains running. No classifier code, threshold, or model configuration was changed during this evaluation.
