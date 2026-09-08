---
name: Precision Instrumentation & Telemetry Architecture
colors:
  surface: '#111316'
  surface-dim: '#111316'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#bac9cc'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#849396'
  outline-variant: '#3b494c'
  surface-tint: '#00daf3'
  primary: '#c3f5ff'
  on-primary: '#00363d'
  primary-container: '#00e5ff'
  on-primary-container: '#00626e'
  inverse-primary: '#006875'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffe9d3'
  on-tertiary: '#472a00'
  tertiary-container: '#ffc681'
  on-tertiary-container: '#7e4e00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#9cf0ff'
  primary-fixed-dim: '#00daf3'
  on-primary-fixed: '#001f24'
  on-primary-fixed-variant: '#004f58'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#111316'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  display-hero:
    fontFamily: JetBrains Mono
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 52px
    letterSpacing: -0.04em
  display-hero-mobile:
    fontFamily: JetBrains Mono
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  telemetry-metric-lg:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.03em
  telemetry-metric-md:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.02em
  telemetry-metric-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.08em
  label-micro:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '500'
    lineHeight: 11px
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  grid-unit: 4px
  space-2xs: 2px
  space-xs: 4px
  space-sm: 8px
  space-md: 12px
  space-lg: 16px
  space-xl: 24px
  space-2xl: 32px
  space-3xl: 48px
  gutter-dense: 8px
  gutter-instrument: 16px
  margin-cockpit: 20px
---

## Brand & Style

The design system embodies the calculated authority and structural refinement of mission-critical aerospace workstations and calibrated industrial telemetry hardware. Engineered for compute edge monitoring, automated high-throughput manufacturing cells, and avionics test benches, the interface prioritizes zero-latency clarity, micro-tactile feedback, and high density without perceptual fatigue. 

The aesthetic movement combines **Industrial Modernism** with **Precision Tactile Instrumentation**:
- **Tactile Calibrated Surfaces:** Chassis plates built from anisotropic brushed zinc and cold-rolled graphite, surfaced with sapphire glass overlays that diffuse specular glare under intense light.
- **Physical Metaphor & Optoelectronic Accuracy:** Pure physical hardware logic drives component design—status indicators render as true optoelectronic LED diodes with distinct refractive lenses, light spill, and diffusion falloff; dividers simulate 0.5px laser-etched metal datum grooves; schematic components reflect circuit PCB topologies.
- **Tone & Response:** Uncompromising, analytical, hyper-focused, and deliberate. The interface responds with immediate mathematical precision, eliminating springy or bouncy consumer micro-animations in favor of damped, linear mechanical transitions.

## Colors

The chromatic architecture is anchored by a graphite-platinum dark-spectrum palette paired with functional telemetry hues strictly bound to international instrumentation and thermal dynamics conventions. Every accent color functions as a data payload, never as passive visual decoration.

### Functional Telemetry Spectrum
- **Cyan Calibrated Cold Bus (`#00E5FF`):** Signal carrier, cryogenic loop nominals, high-frequency active data streams, primary interactive affordances.
- **Emerald Telemetry Sync (`#10B981`):** Nominal operational state, synchronized phase lock, bus telemetry alive, validated parity checks.
- **Amber Thermal Alert (`#F59E0B`):** Threshold excursions, 45° thermal gradient warnings, throttling alerts, non-blocking telemetry variances.
- **Hazard Crimson (`#EF4444`):** Emergency bus shutdown, thermal junction failure, parity drop, safety perimeter breech.
- **Graphite Chassis Base (`#121417`):** Foundation-level carbon/zinc matrix substrate offering non-reflective absorption.

### Surface Tones & Anodized Platings
- **Chassis Plate (Level 0):** `#0B0D0F`
- **Sub-module Layer (Level 1):** `#121417`
- **Machined Inset Surface (Level 2):** `#181B20`
- **Instrument Surface (Level 3):** `#22272E`
- **Laser-Etch Datum Line:** `rgba(255, 255, 255, 0.07)`
- **Sapphire Specular Highlight:** `rgba(255, 255, 255, 0.12)`

## Typography

Typography functions as a precision instrument scale. Visual cadence is governed by two type engines: **Inter** handles narrative controls, structural grouping, and modal telemetry annotations; **JetBrains Mono** governs all register states, raw byte streams, metric units, status readouts, and engineering identifiers.

### Implementation Rules
- **Tabular Numerals:** JetBrains Mono enforces strict tabular formatting (`font-variant-numeric: tabular-nums`). Floating-point variations across rapid serial refreshes must never produce horizontal layout jitter.
- **Metric Micro-Labels:** Engineering prefixes, metric designations (e.g., `mA`, `GHz`, `°C`, `kS/s`), and datum channels utilize `label-caps` or `label-micro` set to all-caps with generous kerning to ensure rapid glance-readability in low-visibility environments.
- **Contextual Contrast:** Secondary metrics and passive units drop to 60% opacity of the active foreground channel, keeping the numerical integer dominant.

## Layout & Spacing

The workstation layout employs an industrial **Dense Matrix Fixed-Aspect Grid** built upon a strict `4px` baseline unit. The screen layout mirrors rack-mounted modular avionics (e.g., Eurocard/VME chassis standards), optimizing information bandwidth while preventing cognitive overload.

### Structure & Distribution
- **Desktop Workstation (1440px+):** Fixed 24-column instrumentation matrix. Gutters are pinned to `16px` for major instrument bays, collapsing to `8px` within sub-register boards. Side instrument rails (telemetry tree, status LED array) conform to fixed hardware widths (`280px` and `320px`), allowing the central vector oscilloscope and schematic viewports to fluidly fill the remainder.
- **Tactile Tablet Interface (768px – 1439px):** Collapses into a 12-column matrix with secondary status rails moving into slide-out hardware drawers. Critical system LEDs pin to a persistent `32px` top diagnostics header.
- **Field Terminal Handheld (<768px):** Single-column stacked hardware cards. Data density adjusts via tabbed hardware banks; metric labels truncate to standard engineering acronyms.

### Rhythmic Alignment
All component heights must resolve to multiples of `4px`. Margins between logical register chips utilize `space-xs` (4px) to preserve visual physical packaging density. Instrument chassis outer frames maintain `space-lg` (16px) perimeter clearance.

## Elevation & Depth

Visual hierarchy does not use diffuse ambient web drop shadows. Instead, it relies on physical **Anisotropic Milling, Subtractive Bevels, and Sapphire Glass Translucency**.

### Physical Depth Stack
1. **Recessed Substrates (Base Chassis):** Deep inset panels use a double border technique: an inner top border of `1px solid rgba(0, 0, 0, 0.7)` and an outer bottom border of `1px solid rgba(255, 255, 255, 0.05)`. This creates a cold-stamped or CNC-milled structural recess.
2. **Surface Plates (Level 1 Modules):** Finished with a faint linear gradient (180deg, `rgba(255,255,255,0.03)` to `rgba(0,0,0,0.2)`) and framed by a `1px` perimeter border in `rgba(255, 255, 255, 0.08)`.
3. **Floating Instrumentation Glass (Level 2 Overlays):** Synthetic sapphire glass plates layered over telemetry charts. Constructed via `backdrop-filter: blur(12px)` with an ultra-fine specular surface reflection (`rgba(255, 255, 255, 0.12)` linear border gradient across the top-left edge).

### Precision Laser-Etch Dividers
Dividers separating electrical registers and channel blocks are constructed using dual hairline seams:
- Top/Left Seam: `1px solid rgba(0, 0, 0, 0.8)` (engraved shadow)
- Bottom/Right Seam: `1px solid rgba(255, 255, 255, 0.06)` (milled aluminum edge highlight)

## Shapes

The design system employs precise, low-radius machined contours. Radius values reflect calibrated machine tolerances rather than organic softening.

### Geometry Architecture
- **Hardware Panels & Sub-assemblies:** Radius pinned to `0.25rem` (`4px`). Retains structural rigidity and mimics tight CNC corner radiuses.
- **Interactive Mechanical Pushbuttons:** Radius set to `2px` or chamfered at 45-degree angles (`clip-path: polygon(...)`) to reflect aerospace switch guards and industrial keypads.
- **Port Enclosures & Chip Pins:** `0px` radius (pure square edges) with hairline interior borders, accurately rendering physical PCB surface-mount integrated circuits.
- **Optoelectronic Lens Diode:** Full circular geometry (`9999px`) contained within an inset square or circular metal bezel collar.

## Components

### Hardware Status LED Diodes
- **Visual Mechanics:** Diodes are composed of a `6px` or `8px` circular emitter seated inside a recessed `10px` metallic bezel with an inner inset shadow.
- **State Properties:**
  - *Nominal Sync (Emerald):* Solid `#10B981` core, intense `1px` white-hot center (`#A7F3D0`), ambient radial glow `box-shadow: 0 0 8px rgba(16, 185, 129, 0.6)`.
  - *Thermal Warning (Amber 45):* Pulsing `#F59E0B` core, radial glow `0 0 10px rgba(245, 158, 11, 0.7)`, flashing at 2Hz for non-acknowledged alerts.
  - *Cold Bus (Cyan):* Steady `#00E5FF` core, radial glow `0 0 8px rgba(0, 229, 255, 0.5)`.
  - *Inactive/Unpowered:* Unlit matte olive/graphite core (`#1E232A`), zero emission, deep physical aperture shadow.

### Tactile Machined Buttons
- **Default State:** Brushed-effect dark zinc background, 1px perimeter border of `rgba(255, 255, 255, 0.1)`, `label-caps` typography, mechanical 0.5px top highlight.
- **Hover/Active:** Top highlight increases to `rgba(255, 255, 255, 0.25)`. Pressed state translates 1px vertically down (`transform: translateY(1px)`) with inner inset shadow (`inset 0 2px 4px rgba(0, 0, 0, 0.6)`), evoking positive mechanical switch detents.
- **Engaged State:** Active state emits a subtle cyan laser trace along the bottom border (`border-bottom: 2px solid #00E5FF`).

### Instrumentation Chips & PCB Component Traces
- **Integrated Circuit Cards:** Monospaced pinout readouts (e.g., `TX-01`, `RX-02`, `VCC-REF`), surrounded by metallic traces with 45° route angles.
- **Real-time Metric Registers:** Two-row telemetry components: upper micro-label in `label-micro` (`rgba(255, 255, 255, 0.5)`), lower numerical metric in `telemetry-metric-md` bound to CSS dynamic transforms for jitter-free tick transitions (`transition: transform 120ms cubic-bezier(0, 0, 0.2, 1)`).

### Input Fields & Parameter Steppers
- **Housing:** Inset milled slot (`#0E1013`), 1px border `rgba(255, 255, 255, 0.08)`. Focused state illuminates an inner border ring of `#00E5FF` with a micro-glow (`0 0 6px rgba(0, 229, 255, 0.3)`).
- **Text Entry:** JetBrains Mono tabular characters with dynamic physical cursor block (`2px` solid `#00E5FF`).

### Checkboxes & Toggle Rockers
- **Checkboxes:** Square, chamfered edge indicators with mechanical interior latch icons (cross-hair or high-contrast mechanical notch, never decorative organic checkmarks).
- **Toggle Rockers:** Dual-state rocker switches with engraved status markings (`ENGAGED` / `ISOLATED`) and physical center pivot shading.

### Vector Oscilloscope & Telemetry Charts
- **Graph Canvas:** CRT/sapphire dark display window with a `16px` graticule grid printed in `rgba(255, 255, 255, 0.04)`.
- **Trace Lines:** Razor-sharp 1px or 1.5px vector traces with variable phosphorescent falloff trails achieved via CSS filters (`drop-shadow(0 0 3px #00E5FF)`).