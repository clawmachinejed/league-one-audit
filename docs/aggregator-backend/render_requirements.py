import json
from pathlib import Path

def render_requirements(d):
    def s(x): return str(x).replace("|","&#124;").replace("\n"," ")
    def table(headers,rows):
        return ["| "+" | ".join(headers)+" |","| "+" | ".join(["---"]*len(headers))+" |"]+["| "+" | ".join(s(x) for x in row)+" |" for row in rows]
    L=["# Atomic requirements and bidirectional verification trace","",
    "Design specification under [README](README.md), derived from [design-requirements.json](design-requirements.json). The JSON ledger owns these stable obligation and case IDs; regenerate this readable view after deliberate ledger edits. It does not create a second product contract.","",
    "Input design commit: "+d["input_commit"]+". Application baseline: "+d["source_baseline"]+". "+str(len(d["requirements"]))+" atomic requirements allocate all "+str(len(d["field_catalog"]))+" top-level foundation fields, all "+str(len(d["constraint_catalog"]))+" record constraints, all "+str(len(d["type_catalog"]))+" named foundation types and all 22 grouped FS cases. These counts establish allocation only. Runtime/database/race/user-validation execution: **none**. Design status: **"+d["design_review"]["status"].replace("_"," ")+"**.","",
    "Requirements are independently falsifiable obligations. Several fields can jointly implement one invariant; a field can support several requirements. Record constraint IDs use the record name and one-based position in the pinned foundation register; exact text in the JSON catalog detects drift. Source anchors are exact substrings, not invented original requirement numbers. Verification cases below are later executable specifications, not passing tests.","",
    "## Roles and source authority",""]
    L+=table(["Owner ID","Existing responsibility","Source paths"],[(o["id"],o["responsibility"],"; ".join(o["paths"])) for o in d["owners"]])
    L+=[""]+table(["Source ID","Classification","Exact anchor"],[("["+x["id"]+"]("+x["path"]+")",x["kind"],x["anchor"]) for x in d["sources"]])
    L+=["","## Forward obligations",""]
    L+=table(["ID","Atomic requirement","Source","Owner","Fields / constraints / types","Verification","Gate"],[(r["id"],r["statement"],", ".join(r["source_ids"]),r["owner"],"; ".join(r["fields"]+r["constraints"]+["type:"+t for t in r["type_refs"]]) or "(preservation/process obligation; no new DTO field)",", ".join(r["case_ids"]),r["gate"]) for r in d["requirements"]])
    L+=["","All obligations have the bounded design status recorded above; runtime status is unexecuted. JSON records preserve allocation rationale and scope. Approved needs remain binding. Derived mechanisms may be replaced only after equivalent proof and synchronized change review; a requirement does not authorize its own implementation.","","## Fixture and evidence controls",""]
    for f in d["fixture_catalog"]: L+=["### "+f["id"],"",f["definition"],""]
    L+=["## Forward design allocation","",d["model_allocation_contract"],""]
    L+=table(["Requirement","Allocated model elements","Concrete design references"],[(r["id"],"; ".join(k+": "+", ".join(v) for k,v in r["design_allocations"].items() if v),"; ".join("["+ref+"]("+ref+")" for ref in r["design_refs"])) for r in d["requirements"]])
    for category,rows in d["model_trace"].items():
        L+=["","### Reverse model allocation: "+category.replace("_"," "),""]
        L+=table(["Model element","Requirement IDs"],[(row["id"],", ".join(row["requirements"])) for row in rows])
    L+=[""]
    L+=["Use independently stated expected outcomes. Before execution record fixture bytes/hash, implementation SHA, role/grant identity, controlled clock/barriers, method, receipts and deviations. SQL cases require every disposable-harness guard. Synthetic fixtures prove handling, not live provider completeness. Never use production/retained data or credentials.","","## Verification specifications",""]
    for c in d["verification_cases"]:
        L+=["### "+c["id"]+" - "+", ".join(c["requirement_ids"]),"",
            "Parent: "+(c["parent_case"] or "additional preservation/process invariant")+". Method: "+", ".join(c["method"])+". Status: **specified, not executed**.","",
            "**Fixture:** "+c["fixture"],"","**Procedure:** "+c["procedure"],"","**Independent oracle:** "+c["oracle"],"","**Required evidence:** "+"; ".join(c["evidence"])+".",""]
    L+=["## Reverse allocation: every field",""]
    L+=table(["Field","Requirement IDs"],[(n,", ".join(r["id"] for r in d["requirements"] if n in r["fields"])) for n in d["field_catalog"]])
    L+=["","## Reverse allocation: every record constraint",""]
    L+=table(["Constraint","Exact snapshot","Requirement IDs"],[(c["id"],c["text"],", ".join(r["id"] for r in d["requirements"] if c["id"] in r["constraints"])) for c in d["constraint_catalog"]])
    L+=["","## Reverse allocation: nested types",""]
    L+=table(["Type","Requirement IDs"],[(n,", ".join(r["id"] for r in d["requirements"] if n in r["type_refs"])) for n in d["type_catalog"]])
    L+=["","SourceScope and DiscoveryScope are reused from existing aggregator contracts; exact source paths/anchors are in external_type_refs. This ledger does not redefine their broader existing types.","","## Reverse allocation: every grouped acceptance case",""]
    L+=table(["Original case","Independent subcases"],[(f"FS{i:02}",", ".join(c["id"] for c in d["verification_cases"] if c["parent_case"]==f"FS{i:02}")) for i in range(1,23)])
    for key,title in [("quality_trace","Quality scenarios"),("decision_trace","Selected engineering alternatives"),("operating_trace","Operating qualification"),("security_trace","Behavior/security controls"),("security_oracle_trace","Behavior/security oracles")]:
        L+=["","## "+title,""]
        L+=table(["Design ID","Requirement allocation","Later qualification"],[(x["id"],", ".join(x["requirements"]),", ".join(x.get("deferred_needs",[])) or "Runtime evidence remains unexecuted") for x in d[key]])
    L+=["","QA/AD/OE IDs refer to [quality decisions and operating evidence](quality-operations.md); BS IDs refer to [behavior/security design](behavior-security-design.md). The selected physical/transaction mechanisms are refined in [relational design](relational-design.md). R095-R108 distinguish selected engineering controls from new product policy or deployed configuration.","","## Deferred or excluded approved needs",""]
    L+=table(["ID","Need / source","Milestone and gate","Disposition / retained obligations"],[(n["id"],n["need"]+" ("+", ".join(n["source_ids"])+")",n["milestone"]+"; "+n["gate"],n["reason"]+" Retained by "+", ".join(n["preserved_by"])+".") for n in d["deferred_needs"]])
    L+=["","## Product decisions",""]
    L+=table(["ID","Status","Boundary","Requirements"],[(n["id"],n["status"],n.get("current_safe_boundary","Exactly 3,600 seconds; approved but not deployed.")+" Gate: "+n["gate"]+".",", ".join(n["requirements"])) for n in d["decisions"]])
    L+=["","## Design review and change control","",
    "Inspect every approved need against its first-slice obligations or explicit deferral, then inspect every field, constraint, nested type and case in the reverse tables. A meaningful allocation and independent oracle are required; arbitrary references do not close gaps. Review state/sequence, relational and threat/quality artifacts using these IDs before accepting the design baseline. Verification against this specification remains distinct from later validation of real manager/co-manager/operator workflows.","",
    "Change impact follows source need -> requirement -> owner/field/constraint/type and selected model element -> case, and reverse. Preserve superseded approvals and design evidence; do not renumber existing IDs to conceal changes. Product decisions require actual product-owner decisions. Independent review records its own findings/limitations; this ledger is not a workshop, production qualification or ISO certification.",""]
    return "\n".join(L)

if __name__ == '__main__':
    import sys
    data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    Path(sys.argv[2]).write_text(render_requirements(data), encoding='utf-8', newline='\n')
