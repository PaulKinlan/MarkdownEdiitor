---
name: data-check
title: Check the data
description: "Check the numbers, tables, charts and calculations in the post: arithmetic, percentages, units, and whether the conclusions follow from the data."
order: 70
---

# Check the data

1. Read the post with read_post. Find every number that is derived or compared: totals, averages, percentages, growth rates, ratios, "X times faster", unit conversions, and every markdown table or data block (CSV, JSON, chart data in a shortcode or script).
2. Recompute, never estimate in your head:
   - use calculate for each derived number (for example `(132 - 98) / 98 * 100` for a percentage change);
   - use table_stats on each table or data block to get column totals, means, medians, ranges and percentage shares, and compare them with what the text says.
3. Check:
   - arithmetic and rounding; percentages that should add to 100;
   - percentage vs percentage points, mean vs median, relative vs absolute change;
   - units and orders of magnitude (ms vs s, KB vs KiB, per day vs per month);
   - small samples, missing baselines, cherry-picked ranges, and correlation presented as causation;
   - whether each conclusion in the text follows from the data shown;
   - whether numbers quoted from elsewhere have a source (use web_search to find it if not).
4. Reply with what is right, what is wrong (with the corrected value and the calculation), and what is weak but not wrong.
5. Propose edits for wrong numbers and conclusions, showing the calculation in the reason. Suggest, in chat, a chart or table where the data would read better that way (the demo-builder skill can build it).
