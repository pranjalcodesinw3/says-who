# Receipts design tokens

Direction: the page is a desk with till receipts on it. Each Bee fact is a paper slip with the evidence printed under it and a verdict stamp. Monospace for everything that was printed, one condensed ticket face for the title.

Fonts (Google Fonts, loaded in the page head): Big Shoulders Display 700 for the title, IBM Plex Mono 400/500/600 for all slip text.

| Token | Value | Use |
|---|---|---|
| --desk | #1f1d1a | page background |
| --desk-2 | #2a2824 | summary strip, buttons on desk |
| --paper | #efe8d8 | slip surface |
| --paper-edge | #d9d0bb | slip rules and dashed tear lines |
| --ink | #1d1b17 | slip text |
| --ink-soft | #5d574a | secondary slip text |
| --chalk | #e9e3d3 | text on desk |
| --chalk-soft | #a49d8c | secondary text on desk |
| --ok | #2d6a4f | supported stamp |
| --warn | #b4561f | likely-TV stamp |
| --bad | #a8321f | no-receipt stamp |

Spacing scale 4/8/12/16/24/40. Radius 2px on slips (paper has corners), 6px on buttons. Type scale 12/14/16/20/40. Slip width 560px max. From 1024px the desk is two columns: a sticky 352px rail (title, the six counts, the live tape) beside the column of slips; below that everything stacks and the verdict stamp sits in the flow under the fact text.
The TV signal is ten paper segments with a gap at 0.5; filled segments turn --warn at or above the line. The live tape is dashed-rule lines, newest first, with a --warn edge on the newest.
Motion: a 120ms background transition on buttons and a 1.6s outline fade on a slip that just arrived, both disabled under prefers-reduced-motion.
