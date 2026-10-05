# Runbook — proofreading a Ghost draft through the browser

How Claude proofreads and comments on a draft at `weaties.ghost.io`. The rules for *what* to change are in [`editor/STYLE.md`](../editor/STYLE.md). This page is *how*, and why each guard exists. Every guard here was added after a real failure on 2026-09-20.

## Why the browser

The site is on Ghost's Starter plan, so there is no Admin API (see `CLAUDE.md`). The Koenig editor in a logged-in browser is the only write path. Koenig is built on Lexical, which keeps its own selection state and ignores much of what a script does to the DOM. So the method is: **scripts only look and aim; every change is made by real keystrokes, between a verified "before" and a checked "after".**

## Setup

1. Use the **Claude Automation** Chrome profile, which is logged into Ghost Admin. Confirm the connected browser is that profile before acting.
2. Open the post's editor URL in a new tab and wait about 6 seconds for the editor to load.
3. Check the status reads `Draft`. If it reads `Published`, stop: read-only checks only, unless the author has approved edits to that post in chat.
4. Print the helpers and paste the output into the javascript tool:

       npm run -s editor:helpers

   It answers `ge 0.1.0 installed` and defines `window.ge`. **Re-inject after every reload**, since a reload wipes it.

   A localhost server to make this a one-line `fetch` was tried and dropped: Chrome's local-network permission prompt hangs the page until a human answers it.

## Read

    ge.dump()        // title, status, block count, number of pages
    ge.page(0)       // then 1, 2, … — tool output truncates near 1000 characters
    ge.block(15)     // one block in full; ge.block(15, 900, 1800) for the rest of a long one

Each line is `index TAG[card]: text`. `DIV[image]` lines are captions. Compare against `editor/STYLE.md` and draw up two lists before touching anything: fixes and comments.

## Fix one typo

Batch these five steps per fix. Any guard that throws halts the batch.

1. `ge.locate('text to click', frameW)` — scrolls it to a fixed height and returns `{x, y, clicks}`. Pass the screenshot frame width the tool reports, which is a little narrower than the window. The text must be unique in the post.
2. **Real mouse click** at `x, y`, as many times as `clicks` says. A caption needs two: the first selects the card, the second enters the caption.
3. `await ge.select(needle, ctx, atEnd)` — selects exactly `needle`, found through a unique surrounding `ctx`. Returns `VERIFIED` only if Lexical's own selection matches. Keep `ctx` inside one sentence, because of the double spaces.
4. **Type** the replacement. To add a full stop, select the last words with `atEnd` true and retype them with the stop.
5. `await ge.changed(newText, oldText)` — throws unless the new text is there and the old text is gone.

Why each step: without the click, typed text is **silently dropped** and nothing reports an error. Without the verify, keystrokes land at the previous caret. Without the post-check, a dropped edit looks like success.

### First letter of a link

Typing over a link's first character puts the new text **outside** the link (`F` + linked `acebook`), and `ge.changed` then fails because neither form is a single text node. Lexical only keeps typed text in the link when the caret is strictly inside it. So insert the new letter second, then delete the old first letter (method from the author, 2026-10-05):

1. `ge.locate` and click the link text as usual.
2. `await ge.select('', 'acebook')`: an empty needle gives a verified caret right after the first letter.
3. Type the new letter. The link now reads `fFacebook`.
4. `await ge.select('', 'Facebook')`: caret between the old letter and the new one. Press `Backspace` once.
5. `await ge.changed('Facebook', 'facebook')`, then confirm the `<a>` around `Facebook` still has its `href`.

If a slip leaves the letter outside the link, one `cmd+z` restores the original.

## Leave a comment

1. `ge.locate(ctx, frameW)` on a **body** paragraph or heading, then a real click.
2. `await ge.caretAfter(ctx)` — verified caret at the end of that block.
3. Press `Return`. Type `/callout`. **Wait 1 second.**
4. `ge.menuOK()` — throws unless the slash menu has narrowed to Callout. Pressing Return early inserts an Image card.
5. Press `Return`. `await ge.inCallout()` — throws unless focus is in a new, empty callout.
6. Type the comment, starting `CLAUDE:`. Do not press Escape afterwards. It leaves the card node-selected, and Lexical then ignores the next scripted caret.
7. **Real click on body text** outside the callout before any further `ge` call. While focus is inside a callout, the main editor drops its `data-koenig-dnd-container` attribute, so `ge.locate` fails with "match is not inside the post body". Re-clicking the block you just anchored to works, since its position has not moved. Then `ge.locate` the next target.

For a comment at the very end, use `ge.locateLastEmptyParagraph(frameW)`, click, `await ge.caretInLastEmptyParagraph()`, then continue from "Type `/callout`" with no Return first.

## Save and prove it

1. Press `cmd+s` and wait 3 seconds.
2. Navigate to the posts list and back to the editor. **"Draft - Saved" is not proof.** A test marker survived once behind that message.
3. Re-inject the helpers, then:

       ge.audit({ gone: ['old typo', …], have: ['new text', …] })

   `stillPresent` and `missing` must be empty, `comments` must equal the number left, and `misplacedComments`, `strayslash` and `emptyImageCards` must be empty or zero. It also lists `emptyParagraphs` and `imagesWithoutCaption` for the report.
4. Close the tab.

## When something goes wrong

- **Text landed in the wrong place, or a wrong card appeared:** press `cmd+z` once, look with `ge.near(ctx)`, and repeat until the blocks match the original. If focus is inside a caption, press Escape first so undo reaches the main editor. An empty stray card that undo will not remove can be deleted with Backspace while it is selected.
- **Ranged deletes are blocked** by the automation permission layer, and rightly. Use undo.
- **A guard throws:** nothing was typed. Read the message, fix the aim, run that fix again.
- **`ge: match is not inside the post body` right after a comment:** focus is still in the callout. Click on body text, then retry (step 7 of "Leave a comment").
- **Never** retry a failing action in a loop. After two attempts, stop and report.

## After the pass

Write the report described at the end of `editor/STYLE.md`. Add any newly confirmed proper nouns to the style sheet's table.
