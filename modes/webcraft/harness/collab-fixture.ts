/** A self-contained page for measuring collaboration without network assets. */
export function collaborationFixture(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fieldwork — Make room for a better idea</title>
  <style>
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f3ee;color:#17251e;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}button,a{-webkit-tap-highlight-color:transparent}nav{height:90px;margin:0 64px;border-bottom:1px solid #bcc5ba;display:flex;align-items:center;justify-content:space-between}nav strong{font-size:25px;letter-spacing:-1.4px}nav div{display:flex;gap:32px;font-size:13px}nav a{text-decoration:none}.hero{padding:82px 64px 88px;display:grid;grid-template-columns:1.1fr 1fr;gap:65px;align-items:center}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#4f6557}h1{font-size:76px;line-height:.98;font-weight:500;letter-spacing:-5px;margin:25px 0 26px}h1 span{color:#59714f}.intro{max-width:350px;font-size:17px;line-height:1.65;color:#5d6b61}.cta{display:inline-flex;background:#223b2b;color:#fff;padding:17px 24px;text-decoration:none;margin-top:20px;font-size:13px;border-radius:3px}.art{height:430px;background:#d6dfc9;position:relative;overflow:hidden;border-radius:2px}.art:before{content:'';position:absolute;width:360px;height:560px;background:#a5b392;transform:rotate(28deg);top:150px;left:-170px}.art:after{content:'';position:absolute;width:180px;height:310px;background:#edf0e5;transform:rotate(-14deg);top:60px;left:100px;box-shadow:24px 30px 0 #485f43}.art .mark{position:absolute;z-index:1;left:127px;top:130px;color:#4b6245;font-family:Georgia,serif;font-size:65px;transform:rotate(-14deg)}.art .caption{position:absolute;z-index:2;bottom:24px;right:24px;font-size:10px;letter-spacing:1px}.strip{background:#233c2d;color:#e8eddf;padding:27px 64px;display:flex;justify-content:space-between;font-size:12px;letter-spacing:1px}.section{padding:85px 64px;border-bottom:1px solid #c9cec2}.section-head{display:flex;justify-content:space-between;align-items:start;gap:70px}.section h2{font-size:44px;line-height:1.06;letter-spacing:-2px;font-weight:500;max-width:440px;margin:0}.section-head p{max-width:360px;font-size:16px;line-height:1.7;color:#5d6b61;margin:0}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:58px}.step{border-top:1px solid #aab7a7;padding-top:20px}.step b{font-size:12px;color:#697c63}.step h3{font-size:22px;font-weight:500;letter-spacing:-.5px;margin:25px 0 12px}.step p{font-size:14px;line-height:1.7;color:#5d6b61;max-width:270px}.note{padding:85px 64px;background:#e5e9dc;display:grid;grid-template-columns:1fr 1fr;gap:70px}.note blockquote{font:36px/1.3 Georgia,serif;letter-spacing:-1px;margin:0}.note div{padding-top:8px}.note p{font-size:15px;line-height:1.8;color:#5d6b61}.note small{font-size:11px;letter-spacing:1px}.footer{padding:40px 64px;display:flex;justify-content:space-between;font-size:12px;color:#5d6b61}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <nav><strong>fieldwork.</strong><div><a href="#approach">Our approach</a><a href="#studio">The studio</a><a href="#contact">Get in touch ↗</a></div></nav>
  <main>
    <section class="hero" id="home">
      <div><div class="eyebrow">An independent creative practice</div><h1 id="hero-title">Make room<br>for a <span>better<br>idea.</span></h1><p class="intro" id="hero-copy">Thoughtful websites for people building something worth paying attention to.</p><a class="cta" href="#approach">Explore our approach ↗</a></div>
      <div class="art" aria-label="A folded paper study in sage and forest green"><span class="mark">f.</span><span class="caption">STUDY 004 — ROOM TO GROW</span></div>
    </section>
    <div class="strip"><span>A LITTLE CURIOSITY GOES A LONG WAY.</span><span>STRATEGY · DESIGN · DEVELOPMENT</span></div>
    <section class="section" id="approach">
      <div class="section-head"><h2>Good work starts<br>with a conversation.</h2><p>We bring different perspectives to the same table. The result is a clearer story, a stronger point of view, and a website that feels like you.</p></div>
      <div class="steps"><article class="step" id="step-listen"><b>01 / LISTEN</b><h3>Find the useful question.</h3><p>Understand the people, the purpose, and the thing that makes your work different.</p></article><article class="step" id="step-make"><b>02 / MAKE</b><h3>Put an idea into the world.</h3><p>Explore, build, and share the work while there is still room to change direction.</p></article><article class="step" id="step-refine"><b>03 / REFINE</b><h3>Make every detail count.</h3><p>Look closely. Ask better questions. Keep the parts that make the experience feel right.</p></article></div>
    </section>
    <section class="note" id="studio"><blockquote id="studio-quote">“The best ideas get better when you have someone to share them with.”</blockquote><div><small>A SMALL STUDIO, AN OPEN DOOR</small><p>We work closely with our collaborators, making progress visible and leaving space for the unexpected. Every project starts with an open conversation.</p><a href="mailto:hello@example.com">Say hello ↗</a></div></section>
  </main>
  <footer class="footer" id="contact"><span>Fieldwork · Independent by design.</span><span>Built with care, together.</span></footer>
</body>
</html>`;
}
