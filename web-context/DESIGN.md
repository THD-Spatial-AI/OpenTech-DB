# Design System Specification: The Kinetic Monolith

## 1. Overview & Creative North Star: "The Digital Curator"
This design system rejects the "dashboard-in-a-box" aesthetic in favor of **The Digital Curator**. In the complex world of energy data, our role is not just to display information, but to archive it with editorial precision. 

The "Kinetic Monolith" approach treats the interface as a physical workspace of stacked, high-grade architectural materials. By utilizing **Space Grotesk** for display and **Inter** for data, we create a tension between Swiss-style brutalism and modern technical efficiency. We break the grid through intentional asymmetry—using heavy left-aligned typography and wide-open gutters—to ensure that even the most data-dense energy reports feel breathable and authoritative.

---

## 2. Colors: Tonal Architecture
We move away from line-drawn boxes. In this system, depth is a product of light and material density, not outlines.

### The "No-Line" Rule
**Explicit Instruction:** 1px solid borders are prohibited for sectioning. Structural boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section sitting on a `surface` background provides all the separation necessary.

### Surface Hierarchy & Nesting
Treat the UI as a series of nested, precision-cut plates. 
- **Base Layer:** `surface` (#f7f9fb)
- **Structural Sections:** `surface-container-low` (#f2f4f6)
- **Interactive Cards:** `surface-container-lowest` (#ffffff)
- **High-Intensity Data:** `surface-container-highest` (#e0e3e5)

### The "Glass & Gradient" Rule
Floating elements (modals, dropdowns) must use **Glassmorphism**. Apply `surface-container-lowest` with 80% opacity and a `24px` backdrop-blur. To provide "visual soul," primary CTAs should utilize a subtle linear gradient from `primary` (#4d4b9e) to `primary_container` (#6564b9) at a 135-degree angle.

---

## 3. Typography: The Editorial Engine
Typography is our primary tool for hierarchy. We use a dual-font strategy to balance character with legibility.

*   **Display & Headlines (Space Grotesk):** These are our "Architectural" weights. Use `display-lg` (3.5rem) for high-level data summaries and `headline-sm` (1.5rem) for section headers. The wider apertures of Space Grotesk signal a modern, technical edge.
*   **Body & Labels (Inter):** The "Workhorse." Inter is used for all technical data points (`body-md` / 0.875rem). It provides the neutral, high-legibility backbone required for energy metrics.
*   **The Technical Label:** `label-sm` (#0.6875rem) should always be in uppercase with a `0.05em` letter-spacing when used for metadata or table headers to evoke a "blueprinted" feel.

---

## 4. Elevation & Depth: Tonal Layering
We achieve "lift" through light physics, not artificial separators.

*   **The Layering Principle:** Instead of shadows, stack containers. Place a `surface-container-lowest` card on a `surface-container-low` background. The subtle 2% shift in brightness creates a sophisticated, "expensive" feel.
*   **Ambient Shadows:** If an element must float (e.g., a critical energy alert), use a shadow with a 40px blur at 4% opacity, using the `on_surface` (#191c1e) color as the tint.
*   **The Ghost Border:** If a border is required for accessibility in data tables, use `outline-variant` (#c3c6d7) at **15% opacity**. Never use 100% opaque lines.
*   **Data Density:** In energy charts, use `primary` for active power loads and `tertiary` (#943700) for warnings. The high contrast against the `surface` ensures immediate cognitive processing.

---

## 5. Components: Primitive Precision

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary_container`), `md` (0.375rem) corner radius. Use `on_primary` text.
*   **Tertiary (Ghost):** No background, `on_surface_variant` text. High-contrast indigo `primary` text on hover with a `surface-container-high` subtle background shift.

### Input Fields & Data Entry
*   **The "Underline" Focus:** Fields should have no border, only a `surface-container-high` background. Upon focus, a 2px `primary` bottom-bar animates from the center.
*   **Technical Chips:** Use `secondary_container` with `on_secondary_container` text. Corners must be `sm` (0.125rem) to maintain the "crisp" technical aesthetic.

### Cards & Data Lists
*   **Rule:** Forbid divider lines.
*   **Implementation:** Separate list items using `spacing-4` (0.9rem) of vertical whitespace. For complex data rows, use alternating backgrounds of `surface` and `surface-container-low` (Zebra striping at a 2% tonal difference).

### Energy-Specific Components
*   **The Pulse Indicator:** For real-time data streams, use a small 8px circle using `primary` with a CSS "ripple" animation to indicate live connectivity.
*   **The Metric Block:** A high-contrast combination of `display-sm` for the value and `label-md` for the unit (e.g., "440 MW"), placed inside a `surface-container-lowest` card.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use `spacing-16` or `spacing-20` for major section padding to create an "Editorial" sense of scale.
*   **Do** use `spaceGrotesk` for all numerical values in hero sections to emphasize the technical nature of the energy database.
*   **Do** nest containers to create hierarchy. A `surface-container-highest` header within a `surface-container-low` page body is the preferred way to signal importance.

### Don’t
*   **Don't** use black (#000). Always use `on_surface` (#191c1e) for text to maintain a premium, slate-like feel.
*   **Don't** use rounded corners larger than `xl` (0.75rem). This system is "crisp" and "technical"; overly rounded corners feel too consumer-focused.
*   **Don't** use standard Material Design drop shadows. If it doesn't look like a physical layer of glass or paper, increase the blur and decrease the opacity.