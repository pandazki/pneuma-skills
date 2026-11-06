# Writing a pack: phrases, poses, actions, captions

## Phrases people send

A sticker stands in for a whole reply. The test for each phrase: would
someone send it alone, as the entire message, several times a week? "收到",
"OK", "thanks", "on my way", "good night" pass; "what a nice day today" does
not.

Start from the people who will use it (the route's opening question): a work
group, a family chat, friends, a client's customers. Ask the user for the
two or three things they type most, then fill the set so it covers the jobs a
reply does instead of one mood eight times:

| Job | Examples |
|---|---|
| acknowledge | 收到 · 好的 · OK · got it |
| on it / wait | 马上 · 稍等 · on my way · one sec |
| thanks / sorry | 谢谢 · 辛苦了 · 抱歉 · thank you |
| state | 加班中 · 摸鱼 · 在开会 · busy |
| celebrate | 下班啦 · 太好了 · yay |
| complain | 不想上班 · 累了 · ugh |
| sign off | 晚安 · 拜拜 · night |

The seed's eight — 收到, 马上, 稍等, 辛苦了, 加班中, 摸鱼, 下班啦, 不想上班 —
are four replies, two states and two moods of one office worker.

Keep the users' own language and register: their slang, their script. A
Chinese pack keeps Chinese captions on Telegram and LINE too; the caption is
part of the drawing, not a label.

## One distinct pose per sticker

People pick from a sticker drawer by silhouette before they read a word.
Vary the whole body, not only the face: stand, run, sit, lie, jump, bow, hug
something, hide behind something. Picture the set as eight black shapes; if
two would look alike, change one. The seed: salute, run in place, raised
hoof, bow, slump and nod off, hug a fish, jump, sit and bawl.

## Actions as body beats, in English

`action` goes into the prompt word for word. Write it in English, present
tense, as two to four beats: the start pose, what moves, and the way back to
the start pose so the loop closes.

| Weak | Strong |
|---|---|
| happy that work is over | jumps straight up with both front hooves thrown in the air and a huge open-mouthed grin, lands, and jumps again |
| says thank you | presses its two front hooves together, bows deeply with eyes closed and a grateful smile, holds the bow for a beat, then straightens up |
| busy | runs in place at full speed facing the viewer, short legs pumping, body leaning forward, a determined frown and one sweat drop flying off its head |

- Name the body the character has (hooves, paws, wings, a tail) and what the
  viewer sees ("eyes squeezed shut, mouth wide open"), not inner states.
- Exaggerate. A sticker shows at about a thumbnail's size; a small tilt is
  invisible.
- One simple prop at most (a fish, a phone, a cup). Props can change or
  vanish between frames, so check every frame.
- Leave out what one looping square cannot hold: camera moves, a change of
  scene, a second character, anything entering from outside the frame,
  writing on props (signs, screens, paper). Effects that rise above the head
  can be clipped at the top edge: the seed's first 加班中 take lost its marks
  off the top in frames 4–7, and the re-roll was clean.
- The model may simplify an action: the seed's 不想上班 was asked to lie on
  its back and sat back kicking instead. Judge whether the sticker reads, not
  whether every beat happened.

## Captions

- The caption is drawn by the model, at the bottom, exactly as written, with
  a white outline. `""` means a sticker without text; then `word` guides the
  face and pose.
- Short: 2–4 characters in Chinese or Japanese, one or two short words in a
  Latin script. A longer caption is drawn smaller and is more likely to come
  out wrong. Across 22 captioned takes on 2026-11-06 (probes, the outline
  experiment and the seed, 2–4 Chinese characters, 336 frames) no character
  was wrong; in the seed, 班 came out with its middle stroke simplified in
  all four takes that contain it, still legible.
- Leave punctuation out; it adds nothing at thumbnail size and is one more
  thing to draw.
- `word` is WeChat's 含义词: at most 4 characters, unique in the set, what a
  person would search for. It may differ from the caption (`word` 加班,
  `caption` 加班中).
- `emoji` is the one emoji Telegram files the sticker under: the emoji a
  person would type for this meaning.

## What never goes in a sticker

- Anyone's likeness without their consent; celebrities; characters, logos
  and brands that belong to someone else, including fan art and memes drawn
  from another person's art (see the rights rule in SKILL.md).
- A child's likeness in a pack meant for a store.
- Hate, harassment, sexual content, real violence, drugs.
- Text beyond the caption: watermarks, signatures, handles, links, QR codes,
  prices. Stores treat these as advertising.
