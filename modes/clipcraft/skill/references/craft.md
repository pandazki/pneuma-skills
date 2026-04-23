# The Craft of Short Video

## Start here

Everything in this document is a mental model, not a procedure. You will
not find steps. You will find principles — the kind of thing that, once
internalized, lets you judge your own work without a checklist.

Most of what's written about AI video is about *how to operate the
model* — prompt formulas, parameter tables, camera vocabularies. That
knowledge is useful and you can pick it up by doing. This document is
the other half: how to think about the thing you're trying to make, so
that when you reach for a prompt formula you already know what you
want.

## A short video is a single idea, not a story

Fifteen to thirty seconds cannot hold a plot. It can barely hold a
shape. The only thing a short video can reliably contain is *one* idea,
felt completely. Two ideas will fight each other in the viewer's mind;
whichever wins, the other feels like interruption.

If you find yourself with two ideas, make two videos. If the second
idea is a detail in service of the first, cut it ruthlessly — you'll
miss it, but the finished piece will feel denser for its absence. The
discipline of short form is the discipline of saying no.

The shape to aim for is *promise and payoff*. In the first beat you
promise something — a question, a setup, a tension. In the remaining
beats you pay it off. If you pay off without promising, the viewer
feels they've arrived somewhere without being invited. If you promise
without paying off, they feel tricked.

## Attention is a currency, not a resource

A resource replenishes. Attention doesn't. Every second you ask for is
a second the viewer spent not watching something else. Every shot must
either *return* attention (a revelation, a surprise, a pleasure) or
*extract more* attention (a promise, a tension, a curiosity). Shots
that do neither — pretty shots that aren't going anywhere, competent
shots that reveal something the viewer already knew — are net-negative.
They teach the viewer that the next shot might also be boring.

This is why cinematic filler is the enemy. A beautiful drone shot over
a coastline is fine as an establishing shot if it's establishing
something the rest of the piece pays off. On its own, it's a frame on
the wall: static, competent, forgettable. Ask of every shot — what
does this make the viewer lean in toward, or exhale from?

## The camera is the narrator

Where you put the camera, and what it does, are not cinematographic
decisions — they're *authorial* ones. The camera is telling the viewer
what to feel.

A slow push-in is not a camera movement. It is intimacy, revelation,
"look closer." A slow pull-back is scale, or isolation, or loss. Static
framing is observation — detached, trustworthy, a little cold. Handheld
is subjectivity and urgency, the body of someone who was there. Low
angle makes the subject powerful; high angle makes it small.

So when you prompt "medium shot, slow dolly in," you are not asking for
a competent shot — you are asking the model to deliver a particular
feeling. Look at this person, they matter, come closer. Choose the
feeling first, then ask for the shot.

Most AI video fails at this because people prompt for *how the shot
looks* — cinematic, 4K, film grain — instead of *what the shot means*.
The model will give you generic-cinematic because that's the average of
its training. You get specificity by asking for specificity of intent.

## Cuts are a small violence; rhythm is the hand that wields them

Every cut is a tiny cognitive shock — the viewer's eye was there, and
suddenly it's here. Rhythm is what makes that shock feel *right*. A
well-timed cut is invisible. A badly-timed cut is a speed bump.

The easiest rule to internalize: cut when the viewer's attention would
have moved anyway. If the outgoing frame has resolved its reason to
exist — the gesture completed, the line delivered, the punchline
landed — the viewer is ready to look elsewhere. A cut at that moment
feels like being led. A cut a beat too early feels like being rushed;
a beat too late, like the piece stalled.

For AI-assisted video, this plays out in segment design. A 15-second
video is three to four beats. A 10-second video is two to three. Trying
to fit four beats into ten seconds is how you get motion artifacts and
physics breakdowns — the model is being asked to animate too many
narrative changes per unit of render time. Single-beat-per-segment
isn't a rule of prompting; it's a rule of attention.

## Sound is structural, not accompaniment

Rough picture with good sound is watchable. Beautiful picture with bad
sound is not. This is counterintuitive until you remember that hearing
is older and more primal than seeing — it processes environment before
consciousness catches up. Music, in particular, is usually doing more
work than the picture. It tells the viewer what mood to be in before
their eyes have parsed the frame.

Silence, used intentionally, is one of the strongest tools available
and is almost always underused. A moment of quiet before a beat lands
is worth more than ten seconds of music ramping up. Ambient sound
grounds reality; the absence of it signals dream, memory, or distance.

When a model generates audio alongside image — Seedance does —
treating audio as an afterthought is active damage, not a missed
opportunity. The model will invent something if you don't say. Usually
what it invents is generic and mismatched.

## Text is a voice, not a label

Eighty-five percent of short video is watched muted. That statistic is
not an accessibility note; it is the governing constraint. In a
muted-by-default medium, captions are not an afterthought — they're
the primary voice channel.

This means text has to be *timed*, not merely present. The caption
should land at the moment its content lands in the story — not before
(you've spoiled it) and not after (you're describing what already
happened). Text that merely transcribes speech is wasting half its
potential. Text that punctuates — arrives at a beat, *says* the beat —
is doing real work.

Typography is voice too. A clean sans says one thing; a display serif
says another. Default choices communicate defaults. If you care about
voice, care about the font.

## AI generates averages. Art is specific.

This is the most important idea in this document. Image and video
models are, at their core, generators of plausible averages. They are
very good at producing generic-cinematic, generic-vlog, generic-cozy.
They are bad at specificity unless asked for it with precision.

Keywords like "cinematic," "4K," "masterpiece" push *toward* the
average. They tell the model "do the thing most people call good," and
the model obliges with the most forgettable version of good. To push
*against* the average, replace adjectives with concrete physical
description — a specific decade, a specific light source, a specific
lens, a specific imperfection. "1970s 35mm slightly faded, handheld at
waist level, long-lens compression" is a direction. "Cinematic" is a
wish.

The same principle covers characters, environments, and motion. "A
woman walking" is a thousand generic women. "A tired woman in a damp
wool coat stepping over a puddle without looking down" is one specific
woman. The first gives you average; the second gives you cinema.

Reference images and videos are tools of specificity. They are not
decoration or inspiration boards — they are the fastest way to say
"this one, not the average." When you anchor a generation on a
reference, you're not copying it; you're triangulating a point in
possibility-space that the model would never land on from prose alone.

## Freshness is something you bring in

The model doesn't only average across styles; it averages across
time. Everything it produces tilts toward the aesthetics and formats
that were ambient when its training data was gathered — which is
never now, always at least a few months behind, often a year or
more. This is why AI-generated video can feel subtly stale even when
it's technically clean. The narrative beats, the music cues, the
editing rhythms, the hook structures it reaches for by default are
*last season's*. Not wrong, not bad, just not *now*. Short video is
a form that lives on being *now* — the frame that feels like
something you haven't quite seen before, even if it's built from
familiar parts.

The model cannot reach for what's currently emerging. It can only
recombine what it already knows. So freshness has to come from
outside: from something you've seen that it hasn't.

This does not mean copying. The point of feeding the model something
recent is not to reproduce it — that just makes you someone who
imitates well. It's to absorb the *texture* of now: what rhythms
feel current, what kind of honesty in delivery, what aesthetic
imperfections are in fashion. Take the texture, not the artifact.
The piece should feel like it belongs to the same moment as the
things that inspired it, not like a remix of them.

Cultivate the opposite skill too: notice what's tired. The model has
defaults it reaches for in the absence of direction — the slow
push-in hook, the sunset drone shot, the lo-fi piano, the ironic
voiceover. These were fresh once. When the model is pulling toward
them, steer away explicitly. A line like "not a drone shot, not a
lo-fi piano, not an ironic voiceover" is sometimes the most useful
thing you can add to a prompt.

The opposite failure of generic-AI is over-chasing trends — making
something that screams *I am fresh* and will look dated in six
months. Freshness is not a style; it's alignment between what you're
making and the moment you're making it in. The test isn't "does this
look fresh now" but "will it feel honest later."

In the room between model and piece, the only source of currency is
you. The model can recombine; only you can notice.

## Taste is yours. Only execution is the model's.

The model does not have taste. It cannot tell you whether your choices
are good. If you ask it to decide between two options, it will pick the
one that sounds more like its training data — which is the more
average one. This is not a bug; it is what averaging does.

Your job is to decide. What should this video feel like? What's the
one idea? Which shots serve it, and which are pretty filler? Those are
judgments the human has to make. The model's job starts after the
judgment: execute the specific thing already decided on.

This is why working with AI video is harder than people expect. You
can't outsource the part that's actually hard (taste), only the part
that used to be hard (execution). Being a better director matters more
than being a better prompter.

## Iterate on the plan, not on the generation

Each generation costs money and time. The instinct to "just try it and
see" is expensive. The cheap iteration loop is planning, sketching,
storyboarding, image-first. A dozen reference images cost less than
one video; composition, character, palette, and vibe can all be
decided before anything moves.

Use image-to-video rather than text-to-video whenever the first frame
matters — which is usually. Use first-last-frame interpolation when
the start and end are known but the middle can be trusted to the
model. Use extend when there is momentum worth preserving. Each of
these reduces uncertainty; text-to-video is maximum uncertainty and
should be the last resort, not the default.

Plan to discard early generations. They are data, not output. The
first version is a test of the prompt; the second is a test of the
revision; the third starts to be the thing. Budget for this, or the
first attempt gets mistaken for the piece.

---

None of this will make anyone a better video-maker by itself — that
comes from making videos. But once these principles sit somewhere in
the back of your head, every choice during production becomes more
legible: you'll know when you're settling for average, when you're
writing an ad instead of a film, when a cut is wrong, when the music
is doing too much or not enough. The craft is in noticing.
