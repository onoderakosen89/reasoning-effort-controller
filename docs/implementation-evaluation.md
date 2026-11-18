# Implementation evaluation

The question is how much work it takes to reach the same verified result once the planner has already narrowed the implementation task.

## One matched repair

A message sent before a conversation opened was omitted from an undelivered-message report. Four fresh copies of the same historical revision received the same failure evidence, expected behavior, and normal control. Codex ran one implementation turn per copy at a fixed effort. The caller ran the same targeted check independently before and after each edit and ran the broader checks afterward.

| Result | GPT-6.1 Terra Low | GPT-6.1 Terra High | GPT-6.2 Sol Low | GPT-6.2 Sol High |
| --- | ---: | ---: | ---: | ---: |
| Targeted failure repaired and normal control preserved | Yes | Yes | Yes | Yes |
| Broader checks passed | 10/15 | 10/15 | 11/15 | 10/15 |
| Additional repair turns | 0 | 0 | 0 | 0 |
| Implementation wall time | 45 s | 67 s | 94 s | 141 s |
| Input tokens (cached portion) | 230,931 (214,784) | 284,284 (259,840) | 544,831 (500,224) | 445,846 (390,784) |
| Output tokens reported by Codex | 1,677 | 2,694 | 3,137 | 5,347 |
| Reasoning output tokens reported by Codex | 214 | 291 | 293 | 2,155 |

Four broader cases remained unresolved in every run. Sol Low also passed the case with two early messages, which failed in the other three runs. Each model used fewer output tokens at Low in this trial. Sol Low used more input tokens, including a larger cached portion.

Wall time covers the Codex command. The independent recheck ran separately. Each condition ran once, in Low-then-High order for each model, with the two models tested in separate batches. Cache and service load can vary. The trial measures a bounded repair, with no measurements of subscription cost, diagnosis, planning, or general success rates.

## Why the evidence matters

In a separate earlier trial on the same problem family, both GPT-6.1 Terra and GPT-6.2 Sol ran at fixed Low:

| Model | With a fuller evidence packet | With a more limited brief |
| --- | ---: | ---: |
| GPT-6.1 Terra | 13/13 entrypoint checks | 9/13 entrypoint checks |
| GPT-6.2 Sol | 13/13 entrypoint checks | 9/13 entrypoint checks |

This earlier comparison used a different fixture and acceptance set. The limited brief still contained a clue about the dropped message, and each condition ran once. These results show which checks passed with each handoff on that trial.
