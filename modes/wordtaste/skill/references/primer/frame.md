# Primer frame

Plain-Chinese framing lines that `run_leaf.ts` wraps around the sampled
passages. The sampler reads the two fenced blocks below verbatim; edit the
words here, never in the script. Both blocks are prose the writer will read,
so they follow the same rule as the passages: no jargon, no instructions
about content.

## before

```text
动笔之前，先读几段以前读过的中文。它们和这次要写的东西没有关系，也不是范文：不要引用，不要借用其中的意象、题材、口吻或人称。读它们，只是为了想起来中文落在纸上可以这样干净、简洁、有呼吸。
```

## after

```text
读完就放下。现在回到上面的任务，带着这几段的简洁和呼吸，只写正文。
```

## voice

Used instead of `before` for a passage that comes from the user's own
`materials/voice/` folder. The sampler appends it after the library passages.

```text
下面这段是作者本人以前写的文字。学它怎么落笔、怎么停顿，不学它写了什么。
```
