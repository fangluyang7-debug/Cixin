---
name: SoleAI Soft Commerce
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#a14000'
  on-secondary: '#ffffff'
  secondary-container: '#ff6a00'
  on-secondary-container: '#571f00'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002117'
  on-tertiary-container: '#009576'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#ffdbcc'
  secondary-fixed-dim: '#ffb694'
  on-secondary-fixed: '#351000'
  on-secondary-fixed-variant: '#7b2f00'
  tertiary-fixed: '#83f7d2'
  tertiary-fixed-dim: '#66dbb7'
  on-tertiary-fixed: '#002117'
  on-tertiary-fixed-variant: '#00513f'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system expresses a refined, editorial "soft luxury tech commerce" persona tailored for contemporary sneaker discovery, outfit inspiration, and real-time algorithmic price comparison. It bridges street culture agility with curated, boutique commerce sensibilities.

The design movement merges **Soft Editorial Minimalism** with tactile, floating physical surfaces:
- Generous breathing space with ultra-subtle off-white and chalk layers.
- High-contrast typography paired with rounded micro-badges and dynamic commerce tags.
- Floating translucent and frosted modules (pill headers, docked input composers) to maximize mobile viewport depth.
- Tactile, rounded micro-interactions that feel responsive and fluid rather than mechanical or strictly corporate.

## Colors

The palette grounds high-energy streetwear products against neutral, calm surfaces. It reserves high-chroma tones strictly for actionable intents, status shifts, and market opportunities.

### Palette Architecture
- **Canvas Base**: `#F2F2F2` (soft parchment tint) establishes the overall viewport backdrop.
- **Surface Elevation**: `#FFFFFF` for primary cards, recommendation chips, floating pill controls, and dialogs.
- **Recessed / Track Neutral**: `#EDEDED` for subtle input reservoirs, inactive progress bars, and recessed image containers.
- **Ink & Neutral Contrast**:
  - Primary Ink: `#111111` for high-impact titles, assertive CTAs, and active icon strokes.
  - Secondary Ink: `#5E5E5E` for descriptive labels and metadata.
  - Muted Inactive: `#7A7A7A` for placeholders and secondary timestamps.
  - Hairline Border: `#E6E6E6` for crisp 1px structural delineations.
- **Accents**:
  - **Vibrant Orange / Coral** (`#FF6A00` / `#E1533D`): Price drop badges, flash offers, and high-conversion transaction points.
  - **Mint / Neo-Glow** (`#8BFFD9`): Online indicators, verified seller status, and active AI engine presence.
  - **Soft Gold** (`#FFD37B`): Collector tiers, exclusive drops, and algorithmic score highlights.
  - **Fresh Stock Green** (`#2E8B57`): Positive price arbitrage, available stock in-market, and best-price verification.

## Typography

The type scale combines **Plus Jakarta Sans** for headers, interactive actions, and numeric badges with **Inter** for conversational AI threads, body summaries, and tabular market specs.

### Rules & Formatting
- **Numerics & Prices**: Enforce `font-variant-numeric: tabular-nums;` across sneaker SKUs, size charts, currency values, and price comparisons to ensure consistent column alignment.
- **Currency Symbols**: Render currency symbols (`¥`, `$`) one size smaller than the numeral (e.g., `12px` indicator next to `16px` price value) with a `font-weight` of `600`.
- **Badges & Micro-tags**: Must use `label-sm` or `label-md` with `text-transform: uppercase` where applicable, maintaining tightened tracking for concise visual density.

## Layout & Spacing

Designed primarily for mobile app environments (iOS Dynamic Island / Android status environments) scaling to modular tablet frames.

### Spatial Rhythm
- **Vertical Base Unit**: 4px standard rhythm (`space-xs` through `space-xl`).
- **Canvas Margins**: Fixed 16px (`1rem`) lateral screen margins for primary content wrappers, maintaining safe borders from native screen perimeters.
- **Card Grids**: Sneaker comparison feeds utilize a 2-column layout with 12px (`0.75rem`) gutters.
- **Z-Index Safe Insets**:
  - Top: 64px offset reserved for the floating pill navigation header.
  - Bottom: 88px reserved clearance above the home indicator to prevent floating composer collisions.

## Elevation & Depth

Visual hierarchy uses ambient diffusion rather than harsh shadows to evoke soft luxury.

### Layer Stack
1. **Base Layer (Canvas)**: Non-elevated `#F2F2F2` canvas.
2. **Elevated Surfaces (Cards, Chips)**: Pure `#FFFFFF` surface with a 1px border stroke of `#E6E6E6` and an ambient shadow: `0 2px 8px rgba(0, 0, 0, 0.03)`.
3. **Floating Controls (Top Pill Bar, Bottom Composer)**: `#FFFFFF` tinted with 92% opacity and a `backdrop-filter: blur(16px)`. Shadow treatment: `0 8px 24px -4px rgba(17, 17, 17, 0.08)`.
4. **Modals & Bottom Drawers**: Solid `#FFFFFF` anchored over a 40% `#111111` diffused backdrop veil.

## Shapes

The interface embraces a continuous pill geometry (`roundedness: 3`) to match fluid handheld ergonomics.

- **Pill Primitives (Full Fillet `9999px`)**: Interactive search recommendations, the primary top app bar, text inputs, CTA buttons, and camera preview triggers.
- **Card Primitives (`rounded-xl` / 24px - 32px)**: Product comparison grids, image cards, and AI diagnostic panels.
- **Internal Containers (`rounded-lg` / 16px)**: Sneaker thumbnail containers, swatch pickers, and individual marketplace pricing rows.

## Components

### Floating Pill Header
- **Container**: Floating pill capsule fixed to the top safe area. Height: 52px, background: `#FFFFFF` (92% blur overlay), border: `1px solid #E6E6E6`.
- **Left Element**: Brand lockup featuring active status pill (5px dot in `#8BFFD9` with subtle pulse glow) next to bold display title.
- **Right Action Group**: Minimal rounded cart trigger with numeric badge (`#FF6A00`, white ink) and a 3-bar hamburger/filter drawer toggle.

### Empty State & Guided Prompts
- **Visual Anchor**: Centered circular illustration aperture (diameter: 120px) featuring a dual-tone lens ring (`#EDEDED` base with `#8BFFD9` accent arc) indicating visual search readiness.
- **Prompt Chips**: Horizontal wrapping list of pill chips (`#FFFFFF`, border `1px solid #E6E6E6`, body-sm typography).
  - Chips: "拍鞋找同款", "男生通勤鞋", "500以内跑鞋", "去得物随便看看".
  - Hover / Active: Surface shifts to `#111111` with crisp white typography.

### Floating Pill Composer (Bottom Dock)
- **Container**: Floating capsule anchored above safe area (16px lateral margin, height: 56px).
- **Sub-Actions**:
  - Visual Lens Trigger: Circular camera icon button (`#EDEDED` fill, 36px diameter).
  - Voice Command Trigger: Microphone toggle icon (`#5E5E5E` stroke).
- **Text Area**: Integrated single-line placeholder ("输入球鞋货号、穿搭需求或拍照比价...") rendered in `body-md` muted ink.
- **Send Trigger**: 40px solid `#111111` circle containing a white directional arrow, scaling dynamically upon input focus.

### Comparison Cards
- **Structure**: Surface `#FFFFFF`, padding 12px, border-radius 20px.
- **Sneaker Media Viewport**: Recessed `#EDEDED` rounded background (1:1 aspect ratio) with high-res PNG centered.
- **Price Metric Stack**: Current best price highlighted in `#111111` bold font accompanied by an adjacent delta pill ("省 ¥140" tagged in `#FF6A00` soft tint).
- **Channel Indicators**: Micro-avatars indicating comparison source nodes (e.g., 得物, 淘宝, 京东, 识货).