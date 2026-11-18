# Implementation evaluation

The question is how much work it takes to reach the same verified result once the planner has already narrowed the implementation task.

## One matched repair

A message sent before a conversation opened was omitted from an undelivered-message report. Two fresh copies of the same historical revision received the same failure evidence, expected behavior, and normal control. Codex used GPT-6.1 Terra for one implementation turn per copy, with fixed Low or fixed High. Neither run used automatic effort switching. The caller ran the same checks independently before and after the edit.

| Result | Fixed Low | Fixed High |
| --- | ---: | ---: |
| Targeted failure repaired and normal control preserved | Yes | Yes |
| Broader checks passed | 10/15 | 10/15 |
| Additional repair turns | 0 | 0 |
| Implementation wall time | 45 s | 67 s |
| Input tokens (cached portion) | 230,931 (214,784) | 284,284 (259,840) |
| Output tokens reported by Codex | 1,677 | 2,694 |
| Reasoning output tokens reported by Codex | 214 | 291 |

Both variants left the same five out-of-scope cases unresolved. The stops and pass criteria for planning or diagnosis were outside this trial. Time measures the Codex command, with the independent recheck measured separately from the repair turn. This is a single run per setting, in Low-then-High order. Cache and service load can vary. No subscription cost or general success rate was measured.

## Why the evidence matters

In a separate earlier trial on the same problem family, Terra at Low passed all 13 entrypoint checks when it received a fuller evidence packet. The run given a more limited brief passed 9 of 13. That earlier comparison used a different fixture and acceptance set. It gives a reason to invest in the check and the handoff before spending more on implementation.
