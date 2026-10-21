# Receipts design tokens

Direction: the page is a desk with till receipts on it. Each Bee fact is a paper slip with the evidence printed under it and a verdict stamp. Monospace for everything that was printed, one condensed ticket face for the title.

Fonts (Google Fonts, loaded in the page head): Big Shoulders Display 700 for the title, IBM Plex Mono 400/500/600 for all slip text.

| Token | Value | Use |
|---|---|---|
| --desk | #1d1d1b | page background |
| --desk-2 | #292927 | summary strip, buttons on desk |
| --paper | #e4e5df | slip surface |
| --paper-edge | #d0cdc2 | slip rules and dashed tear lines |
| --ink | #1c1b18 | slip text |
| --ink-soft | #55524a | secondary slip text |
| --chalk | #e6e4dd | text on desk |
| --chalk-soft | #aaa8a0 | secondary text on desk |
| --ok | #1f5a3f | supported stamp |
| --warn | #8a3f10 | likely-TV stamp |
| --bad | #922a18 | no-receipt stamp |

Spacing scale 4/8/12/16/24/40. Radius 2px on slips (paper has corners), 6px on buttons. Type scale 13/14/16/20/28. Slip width 560px max. From 1024px the desk is two columns: a sticky 352px rail (title, the six counts, the live tape) beside the column of slips; below that everything stacks and the verdict stamp sits in the flow under the fact text.
The TV signal is ten paper segments with a gap at 0.5; filled segments turn --warn at or above the line. The live tape is dashed-rule lines, newest first, with a --warn edge on the newest.
Motion: a 120ms background transition on buttons and a 1.6s outline fade on a slip that just arrived, both disabled under prefers-reduced-motion.
