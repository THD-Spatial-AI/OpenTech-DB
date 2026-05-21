# Contributing Data

This guide is for **energy researchers** who want to add new parameter data to the OpenTech-DB catalogue — for example, CAPEX values for a new electrolyzer variant, updated efficiency figures from a recent IRENA report, or storage round-trip efficiency from a manufacturer datasheet.

You do not need to understand code, databases, or the Open Energy Ontology (OEO) to contribute. The review process handles ontology alignment. What you do need is **data with sources**.

---

## Before you start

- You need an account. Register or log in using your [ORCID iD](https://orcid.org) — the standard researcher identifier.
- Every parameter value you submit **must have a source** (paper, technical report, or dataset) and a **reference year**. Submissions without sources will be rejected.
- Browse the existing catalogue first to check whether the Technology you want to contribute to already exists and whether your data would be a new Instance or an update to an existing one.

---

## Key concepts

**Technology** — a category of energy device (e.g., "PEM Electrolyzer", "Offshore Wind Fixed-bottom"). One Technology groups many Instances.

**Instance** — one specific data point within a Technology: a manufacturer variant, a projection scenario, or a vintage (e.g., "PEM Electrolyzer – 1 MW, IRENA 2023"). Your contribution will be one or more Instances.

**Parameter** — a measured quantity (e.g., CAPEX, efficiency, lifetime). Every Parameter must carry:
- a numeric value
- a unit (e.g., USD/kW, %, years)
- an optional uncertainty range (min / max)
- a **source** — bibliographic reference (author, title, year, URL or DOI if available)
- a **reference year** — the year the data represents, not the publication year

---

## Step-by-step

### 1. Log in

Click **Sign in** in the top navigation bar and authenticate with your ORCID iD.

### 2. Open the Contributor workspace

Navigate to **Contribute** in the sidebar. You will see the contributor workspace with a list of existing Technologies.

### 3. Find the right Technology

Search or browse the catalogue to find the Technology you want to contribute an Instance to. If the Technology does not exist yet, you can create a new one — fill in the name, domain (generation / storage / transmission / conversion), and a short description.

### 4. Add an Instance

Click **Add Instance** on the Technology card. Fill in:

| Field | Required | Notes |
|---|---|---|
| Instance name | Yes | Descriptive label, e.g. "PEM Electrolyzer – 1 MW, IRENA 2023" |
| Reference year | Yes | Year the data represents |
| Life-cycle stage | Yes | `commercial`, `projection`, or `demonstration` |
| CAPEX (USD/kW) | If available | Include source and year |
| Fixed O&M (USD/kW/yr) | If available | Include source and year |
| Variable O&M (USD/MWh) | If available | Include source and year |
| Efficiency (%) | If available | Include source and year |
| Economic lifetime (years) | If available | Include source and year |
| Other parameters | If available | Use the "Extra parameters" section |

You do not need to fill in every field — partial submissions are accepted as long as each filled field has a source.

### 5. Cite your sources

For each Parameter, enter a source reference. Acceptable formats:

- **Report:** IRENA (2023). *Renewable Power Generation Costs 2023*. IRENA, Abu Dhabi. URL or DOI.
- **Paper:** Author et al. (2022). Title. *Journal*, vol., pp. DOI.
- **Datasheet:** Manufacturer name. *Product datasheet title*. Year. URL.

If a single source covers all parameters in the Instance, you can set it once at the Instance level.

### 6. Submit

Click **Submit for review**. Your Submission enters a `pending` state — it is now queued for admin review and will not appear in the public catalogue until approved.

---

## What happens after submission

1. A maintainer reviews your Submission for completeness, source validity, and consistency with existing data.
2. If approved, a pull request is opened automatically that merges your data into the catalogue JSON. Once the PR is merged, your Instance is live.
3. If changes are needed, you will receive feedback via the platform and can edit and resubmit.
4. If rejected, you will receive a reason.

Review typically takes a few business days.

---

## What you do not need to worry about

- **OEO ontology fields** (`oeo_class`, `oeo_uri`) — the reviewer handles ontology alignment during review. You only need to provide the data and sources.
- **JSON format** — the contributor UI handles formatting. You never edit JSON files directly.
- **Unit conversion** — submit values in the units stated in each field label. The system handles conversions to internal units.

---

## Questions

Open an issue on the [GitHub repository](https://github.com/THD-Spatial-AI/OpenTech-DB/issues) or contact the maintainers at the Deggendorf Institute of Technology.
