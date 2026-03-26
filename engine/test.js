"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — Comprehensive Test Suite
// ============================================================================
//
//  Run:  node engine/test.js
//
//  Deterministic via seeded PRNG (mulberry32).
//
// ============================================================================

const {
    buildDeck, makeCard, isDrawCard, isWild,
    COLORS,
    cloneState, currentPlayer, topDiscard,
    aliveCount, drawCards, advancePlayer,
    initGame, getPlayableCards, isCardPlayable,
    playCard, drawUntilPlayable, resolveStack,
    resolveColorRoulette, completeSwap,
    sayUno, callOutUno, checkLastStanding, findPlayer,
    gameReducer, ActionTypes,
} = require("./index");

// ── Seeded PRNG ─────────────────────────────────────────────────────────────

function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Test harness ────────────────────────────────────────────────────────────

let _passed = 0, _failed = 0;

function section(name) {
    console.log("\n\x1b[1m═══ " + name + " ═══\x1b[0m");
}

function assert(cond, msg) {
    if (cond) { _passed++; console.log("  \x1b[32mPASS\x1b[0m " + msg); }
    else      { _failed++; console.log("  \x1b[31mFAIL\x1b[0m " + msg); }
}

function assertEq(a, b, msg) {
    assert(a === b, msg + " (got " + a + ", expected " + b + ")");
}

function assertThrows(fn, msg) {
    try { fn(); _failed++; console.log("  \x1b[31mFAIL\x1b[0m " + msg + " (no throw)"); }
    catch (e) { _passed++; console.log("  \x1b[32mPASS\x1b[0m " + msg + " → " + e.message); }
}

function cardStr(c) {
    if (!c) return "null";
    if (c.type === "number") return c.color + "-" + c.value;
    return c.color + "-" + c.type + (c.drawValue ? "(+" + c.drawValue + ")" : "");
}

// ============================================================================
//  TEST 1: Deck composition
// ============================================================================

section("1. Deck Composition (168 cards)");
{
    const deck = buildDeck();
    assertEq(deck.length, 168, "Deck has 168 cards");

    // Count by color
    const byColor = {};
    for (const c of deck) byColor[c.color] = (byColor[c.color] || 0) + 1;
    assertEq(byColor.red, 38, "Red: 38 cards");
    assertEq(byColor.blue, 38, "Blue: 38 cards");
    assertEq(byColor.green, 38, "Green: 38 cards");
    assertEq(byColor.yellow, 38, "Yellow: 38 cards");
    assertEq(byColor.wild, 16, "Wild: 16 cards");

    // Count colored +4s (NOT wild)
    const coloredDraw4 = deck.filter(c => c.type === "draw4" && c.color !== "wild");
    assertEq(coloredDraw4.length, 8, "+4 is colored (8 total, 2 per color)");

    // Count wilds
    const wildR4 = deck.filter(c => c.type === "wild_reverse_draw4");
    const wildD6 = deck.filter(c => c.type === "wild_draw6");
    const wildD10 = deck.filter(c => c.type === "wild_draw10");
    const wildCR = deck.filter(c => c.type === "wild_color_roulette");
    assertEq(wildR4.length, 4, "4× White Reverse+4");
    assertEq(wildD6.length, 4, "4× White +6");
    assertEq(wildD10.length, 4, "4× White +10");
    assertEq(wildCR.length, 4, "4× White Color Roulette");

    // Count numbers: 1×0 + 3×(1-9) = 28 per color
    const redNums = deck.filter(c => c.color === "red" && c.type === "number");
    assertEq(redNums.length, 28, "Red numbers: 1×0 + 3×(1-9) = 28");

    // Count discard_all and skip_everyone
    const discAll = deck.filter(c => c.type === "discard_all");
    const skipAll = deck.filter(c => c.type === "skip_everyone");
    assertEq(discAll.length, 4, "4× Discard All (1 per color)");
    assertEq(skipAll.length, 4, "4× Skip Everyone (1 per color)");
}

// ============================================================================
//  TEST 2: Initialization
// ============================================================================

section("2. Game Initialization");
{
    const rng = mulberry32(42);
    const state = initGame(["Alice", "Bob", "Charlie"], rng);

    assertEq(state.players.length, 3, "3 players");
    assertEq(state.players[0].hand.length, 7, "7 cards each");
    assertEq(state.players[1].hand.length, 7, "Bob: 7 cards");
    assertEq(state.players[2].hand.length, 7, "Charlie: 7 cards");
    assert(state.players.every(p => p.alive), "All alive");
    assertEq(state.discardPile.length, 1, "1 starting card");
    assertEq(state.direction, 1, "Clockwise");
    assertEq(state.stackValue, 0, "No stack");
    assertEq(state.winner, null, "No winner");

    const top = topDiscard(state);
    assertEq(top.type, "number", "Starter is number");
    assert(top.color !== "wild", "Starter is colored");

    // Draw pile should have 168 - 21 (dealt) - 1 (starter) = 146
    assertEq(state.drawPile.length, 146, "Draw pile: 146 cards");

    assertThrows(() => initGame(["solo"]), "Reject <2 players");
    assertThrows(() => initGame(["a","b","c","d","e","f","g"]), "Reject >6 players");
}

// ============================================================================
//  TEST 3: Playable cards logic
// ============================================================================

section("3. Playable Cards");
{
    const rng = mulberry32(42);
    const state = initGame(["A", "B"], rng);
    const player = state.players[0];
    const playable = getPlayableCards(player, state);
    const top = topDiscard(state);
    const color = state.currentColor;

    assert(Array.isArray(playable), "Returns array");
    for (const c of playable) {
        assert(isCardPlayable(c, top, color),
            cardStr(c) + " is legally playable on " + cardStr(top));
    }

    // Non-playable cards
    const nonPlayable = player.hand.filter(c => !playable.includes(c));
    for (const c of nonPlayable) {
        assert(!isCardPlayable(c, top, color),
            cardStr(c) + " correctly excluded");
    }
}

// ============================================================================
//  TEST 4: Stacking with >= rule
// ============================================================================

section("4. Stacking (+X >= last)");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);

    // Give A a red +2, set top to red number

    const d2 = makeCard("red", "draw2");
    state.players[0].hand.push(d2);
    state.currentColor = "red";

    state = playCard(state, "A", d2.id);
    assertEq(state.stackValue, 2, "Stack = 2 after +2");
    assertEq(state.lastDrawValue, 2, "lastDrawValue = 2");
    assertEq(state.pendingAction, "stack", "Pending = stack");
    assertEq(currentPlayer(state).id, "B", "B's turn");

    // B can only play draw cards with value >= 2
    const bPlayable = getPlayableCards(state.players[1], state);
    for (const c of bPlayable) {
        assert(isDrawCard(c) && c.drawValue >= 2,
            cardStr(c) + " has drawValue >= 2");
    }

    // Give B a +4 to stack
    const d4 = makeCard("blue", "draw4");
    state.players[1].hand.push(d4);

    state = playCard(state, "B", d4.id);
    assertEq(state.stackValue, 6, "Stack = 2 + 4 = 6");
    assertEq(state.lastDrawValue, 4, "lastDrawValue = 4");
    assertEq(currentPlayer(state).id, "C", "C's turn");

    // C can only play +4, +6, or +10 (>= 4)
    const cPlayable = getPlayableCards(state.players[2], state);
    for (const c of cPlayable) {
        assert(c.drawValue >= 4,
            cardStr(c) + " has drawValue >= 4");
    }

    // C resolves — draws 6
    const handBefore = state.players[2].hand.length;
    state = resolveStack(state, "C");
    assert(state.players[2].hand.length >= handBefore + 6,
        "C drew at least 6 cards (" + state.players[2].hand.length + ")");
    assertEq(state.stackValue, 0, "Stack cleared");
    assertEq(state.pendingAction, null, "No pending action");
}

// ============================================================================
//  TEST 5: Wrong turn / illegal plays
// ============================================================================

section("5. Illegal Moves");
{
    const rng = mulberry32(42);
    const state = initGame(["A", "B"], rng);

    assertThrows(
        () => playCard(state, "B", state.players[1].hand[0].id),
        "Wrong turn rejected"
    );
    assertThrows(
        () => drawUntilPlayable(state, "B"),
        "Wrong turn draw rejected"
    );
    assertThrows(
        () => resolveStack(state, "A"),
        "No stack to resolve"
    );
}

// ============================================================================
//  TEST 6: Reverse (2-player = skip)
// ============================================================================

section("6. Reverse (2-player skip)");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);


    const rev = makeCard("red", "reverse");
    state.players[0].hand.push(rev);
    state.currentColor = "red";

    state = playCard(state, "A", rev.id);
    assertEq(state.direction, -1, "Direction reversed");
    assertEq(currentPlayer(state).id, "A", "A plays again (2p skip)");
}

// ============================================================================
//  TEST 7: Skip
// ============================================================================

section("7. Skip");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);


    const skip = makeCard("red", "skip");
    state.players[0].hand.push(skip);
    state.currentColor = "red";

    state = playCard(state, "A", skip.id);
    assertEq(currentPlayer(state).id, "C", "B was skipped, C plays next");
}

// ============================================================================
//  TEST 8: Discard All
// ============================================================================

section("8. Discard All");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);


    // Give A several red cards + the discard all
    const da = makeCard("red", "discard_all");
    const r1 = makeCard("red", "number", 3);
    const r2 = makeCard("red", "number", 5);
    const b1 = makeCard("blue", "number", 2);
    state.players[0].hand = [r1, r2, b1, da];
    state.currentColor = "red";

    state = playCard(state, "A", da.id);

    // A should have discarded all red cards → only blue-2 remains
    assertEq(state.players[0].hand.length, 1, "A has 1 card left (blue)");
    assertEq(state.players[0].hand[0].color, "blue", "Remaining card is blue");
}

// ============================================================================
//  TEST 9: Skip Everyone
// ============================================================================

section("9. Skip Everyone");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C", "D"], rng);
    state = cloneState(state);


    const se = makeCard("red", "skip_everyone");
    state.players[0].hand.push(se);
    state.currentColor = "red";

    state = playCard(state, "A", se.id);
    assertEq(currentPlayer(state).id, "A", "A plays again (skip everyone)");
}

// ============================================================================
//  TEST 10: Wild Reverse +4 (2-player special)
// ============================================================================

section("10. White Reverse+4 (2-player special)");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);

    const handBefore = state.players[0].hand.length;

    const wr4 = makeCard("wild", "wild_reverse_draw4");
    state.players[0].hand.push(wr4);

    state = playCard(state, "A", wr4.id, "red");

    // 2-player special: A draws 4 themselves!
    assert(state.players[0].hand.length >= handBefore + 4 - 1,
        "A drew 4 cards (played 1, gained 4)");
    // A can respond to their own penalty via stacking
    assertEq(state.pendingAction, "stack", "A has stack pending to redirect");
    assertEq(currentPlayer(state).id, "A", "Still A's turn (can redirect)");
}

// ============================================================================
//  TEST 11: Wild +6 and +10
// ============================================================================

section("11. Wild +6 / +10");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);


    const d6 = makeCard("wild", "wild_draw6");
    state.players[0].hand.push(d6);

    state = playCard(state, "A", d6.id, "green");
    assertEq(state.stackValue, 6, "+6 stack");
    assertEq(state.lastDrawValue, 6, "lastDrawValue = 6");
    assertEq(state.currentColor, "green", "Color = green");

    // B can only respond with +6 or +10
    const bPlayable = getPlayableCards(state.players[1], state);
    for (const c of bPlayable) {
        assert(c.drawValue >= 6, cardStr(c) + " has value >= 6");
    }
}

// ============================================================================
//  TEST 12: Color Roulette
// ============================================================================

section("12. Color Roulette");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);


    const cr = makeCard("wild", "wild_color_roulette");
    state.players[0].hand.push(cr);

    state = playCard(state, "A", cr.id, "red");
    assertEq(state.pendingAction, "color_roulette_pick", "Roulette pending");
    assertEq(currentPlayer(state).id, "B", "B must pick color");

    const handBefore = state.players[1].hand.length;
    const result = resolveColorRoulette(state, "B", "blue");
    state = result.state;

    assert(result.revealedCards.length > 0, "Cards were revealed");
    assert(state.players[1].hand.length > handBefore ||
           !state.players[1].alive,
        "B drew cards (or was eliminated)");
    assertEq(state.pendingAction, null, "Roulette resolved");
}

// ============================================================================
//  TEST 13: UNO declaration + call-out
// ============================================================================

section("13. UNO System");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);

    // Force A to 1 card, no UNO declared
    state.players[0].hand = [state.players[0].hand[0]];
    state.players[0].saidUno = false;

    // B calls out A → penalty 2 cards
    let result = callOutUno(state, "B", "A");
    assert(result.success, "Call-out succeeded");
    assertEq(result.state.players[0].hand.length, 3, "A has 1+2 = 3 cards");

    // Now A says UNO first
    state = cloneState(state);
    state.players[0].hand = [state.players[0].hand[0]];
    state = sayUno(state, "A");
    assert(state.players[0].saidUno, "A said UNO");

    result = callOutUno(state, "B", "A");
    assert(!result.success, "Call-out failed (UNO was said)");
    assertEq(result.state.players[0].hand.length, 1, "A still has 1");
}

// ============================================================================
//  TEST 14: Elimination (25+ cards)
// ============================================================================

section("14. Elimination at 25 cards");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);

    // Give B 24 cards (just under threshold)
    while (state.players[1].hand.length < 24) {
        state.players[1].hand.push(makeCard("red", "number", 1));
    }
    assert(state.players[1].alive, "B alive at 24 cards");

    // Draw 1 more → 25 → eliminated
    state = drawCards(state, 1, 1);

    assertEq(state.players[1].alive, false, "B eliminated at 25+ cards");
    assertEq(state.players[1].hand.length, 0, "B's hand cleared");
    assert(state.eliminatedCards.length >= 25, "Cards moved to eliminated pool");
}

// ============================================================================
//  TEST 15: Rule of 7 (swap)
// ============================================================================

section("15. Rule of 7 (Swap)");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);


    const seven = makeCard("red", "number", 7);
    state.players[0].hand = [seven, makeCard("blue", "number", 1)];
    state.players[2].hand = [
        makeCard("green", "number", 3),
        makeCard("green", "number", 4),
        makeCard("green", "number", 5),
    ];
    state.currentColor = "red";

    // Play 7 with swap target C
    state = playCard(state, "A", seven.id, null, "C");

    // A should now have C's 3 cards, C should have A's 1 remaining card
    assertEq(state.players[0].hand.length, 3, "A got C's 3 cards");
    assertEq(state.players[2].hand.length, 1, "C got A's 1 card");
}

// ============================================================================
//  TEST 16: Rule of 0 (Rotate)
// ============================================================================

section("16. Rule of 0 (Rotate)");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);

    // Set distinct hand sizes

    state.players[0].hand = [
        makeCard("red", "number", 0),
        makeCard("red", "number", 1),
    ];
    state.players[1].hand = [
        makeCard("blue", "number", 2),
        makeCard("blue", "number", 3),
        makeCard("blue", "number", 4),
    ];
    state.players[2].hand = [
        makeCard("green", "number", 5),
    ];
    state.currentColor = "red";

    // A plays 0 → rotate clockwise
    // A(2) → B(3) → C(1) becomes: A gets C's(1), B gets A's(1 after play), C gets B's(3)
    const zero = state.players[0].hand[0];
    state = playCard(state, "A", zero.id);

    // After play: A had [red-1], B had [blue-2,3,4], C had [green-5]
    // Rotate clockwise: A←C, B←A, C←B
    // A gets C's [green-5] → 1 card
    // B gets A's [red-1] → 1 card
    // C gets B's [blue-2,3,4] → 3 cards
    assertEq(state.players[0].hand.length, 1, "A has 1 card (from C)");
    assertEq(state.players[1].hand.length, 1, "B has 1 card (from A)");
    assertEq(state.players[2].hand.length, 3, "C has 3 cards (from B)");
}

// ============================================================================
//  TEST 17: Draw until playable
// ============================================================================

section("17. Draw Until Playable");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);

    // Remove all playable cards from A's hand to force drawing
    state = cloneState(state);
    const top = topDiscard(state);
    state.players[0].hand = state.players[0].hand.filter(
        c => !isCardPlayable(c, top, state.currentColor)
    );
    // If hand became empty, add a non-matching card
    if (state.players[0].hand.length === 0) {
        const otherColor = COLORS.find(c => c !== state.currentColor);
        state.players[0].hand.push(makeCard(otherColor, "number", 9));
    }

    const handBefore = state.players[0].hand.length;
    const result = drawUntilPlayable(state, "A");

    assert(result.drawnCards.length > 0, "Drew at least 1 card");
    if (result.playableCard) {
        assert(isCardPlayable(result.playableCard, topDiscard(result.state),
            result.state.currentColor),
            "Playable card is actually playable");
    }
}

// ============================================================================
//  TEST 18: Win by empty hand
// ============================================================================

section("18. Win by Empty Hand");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B"], rng);
    state = cloneState(state);


    const lastCard = makeCard("red", "number", 5);
    state.players[0].hand = [lastCard];
    state.currentColor = "red";
    state.players[0].saidUno = true;

    state = playCard(state, "A", lastCard.id);
    assertEq(state.winner, "A", "A wins with empty hand");
}

// ============================================================================
//  TEST 19: Win by last standing
// ============================================================================

section("19. Win by Last Standing");
{
    const rng = mulberry32(42);
    let state = initGame(["A", "B", "C"], rng);
    state = cloneState(state);

    // Eliminate B and C manually
    state.players[1].alive = false;
    state.players[1].hand = [];
    state.players[2].alive = false;
    state.players[2].hand = [];

    state = checkLastStanding(state);
    assertEq(state.winner, "A", "A wins as last standing");
}

// ============================================================================
//  TEST 20: Reducer pattern
// ============================================================================

section("20. Reducer");
{
    const rng = mulberry32(77);
    let state = initGame(["A", "B", "C"], rng);

    state = gameReducer(state, { type: ActionTypes.SAY_UNO, playerId: "A" });
    assert(state.players[0].saidUno, "SAY_UNO works");

    const drawResult = gameReducer(state, {
        type: ActionTypes.DRAW_UNTIL_PLAY, playerId: "A",
    });
    assert(drawResult.drawnCards !== undefined, "DRAW returns drawnCards");

    assertThrows(
        () => gameReducer(state, { type: "NOPE", playerId: "A" }),
        "Rejects unknown action"
    );
}

// ============================================================================
//  TEST 21: Full auto-play simulation
// ============================================================================

section("21. Full Auto-Play Simulation");
{
    const rng = mulberry32(54321);
    let state = initGame(["Alice", "Bob", "Charlie", "Dave"], rng);

    const MAX_TURNS = 1000;
    let turns = 0;
    let eliminations = 0;

    while (!state.winner && turns < MAX_TURNS) {
        turns++;
        const cp = currentPlayer(state);
        if (!cp.alive) { state = advancePlayer(cloneState(state)); continue; }

        // ── Handle pending actions ──────────────────────────────────
        if (state.pendingAction === "stack") {
            const stackable = getPlayableCards(cp, state);
            if (stackable.length > 0 && rng() > 0.3) {
                const card = stackable[0];
                const color = isWild(card) ? pickBestColor(cp) : null;
                try { state = playCard(state, cp.id, card.id, color); }
                catch (_) { state = resolveStack(state, cp.id); }
            } else {
                state = resolveStack(state, cp.id);
            }
            continue;
        }

        if (state.pendingAction === "color_roulette_pick") {
            const result = resolveColorRoulette(state, cp.id, pickBestColor(cp));
            state = result.state;
            continue;
        }

        if (state.pendingAction === "swap_pick") {
            const targets = state.players.filter(p => p.alive && p.id !== state.lastPlayerId);
            if (targets.length > 0) {
                // Swap with player who has fewest cards
                targets.sort((a, b) => a.hand.length - b.hand.length);
                state = completeSwap(state, state.lastPlayerId, targets[0].id);
            } else {
                // Edge case: no valid target, just advance
                let s = cloneState(state);
                s.pendingAction = null;
                s = advancePlayer(s);
                state = s;
            }
            continue;
        }

        // ── Normal turn ─────────────────────────────────────────────
        const playable = getPlayableCards(cp, state);

        if (playable.length > 0) {
            if (cp.hand.length === 2) state = sayUno(state, cp.id);

            const card = playable[Math.floor(rng() * playable.length)];
            let color = isWild(card) ? pickBestColor(cp) : null;
            let swap = null;
            if (card.type === "number" && card.value === 7) {
                const targets = state.players.filter(p => p.alive && p.id !== cp.id);
                if (targets.length > 0) {
                    targets.sort((a, b) => a.hand.length - b.hand.length);
                    swap = targets[0].id;
                }
            }

            try {
                state = playCard(state, cp.id, card.id, color, swap);
            } catch (e) {
                // Fallback: draw
                const result = drawUntilPlayable(state, cp.id);
                state = result.state;
                if (result.playableCard && currentPlayer(state).id === cp.id) {
                    try {
                        const c = result.playableCard;
                        state = playCard(state, cp.id, c.id,
                            isWild(c) ? pickBestColor(findPlayer(state, cp.id)) : null);
                    } catch (_) { /* skip */ }
                }
            }
        } else {
            const result = drawUntilPlayable(state, cp.id);
            state = result.state;
            if (result.playableCard && currentPlayer(state).id === cp.id &&
                findPlayer(state, cp.id) && findPlayer(state, cp.id).alive) {
                const c = result.playableCard;
                const p = findPlayer(state, cp.id);
                try {
                    state = playCard(state, cp.id, c.id,
                        isWild(c) ? pickBestColor(p) : null);
                } catch (_) { /* skip */ }
            }
        }

        // Track eliminations
        const nowAlive = aliveCount(state);
        if (nowAlive < 4 - eliminations) {
            eliminations = 4 - nowAlive;
        }
    }

    function pickBestColor(player) {
        if (!player || !player.hand) return "red";
        const counts = { red: 0, green: 0, blue: 0, yellow: 0 };
        for (const c of player.hand) {
            if (counts.hasOwnProperty(c.color)) counts[c.color]++;
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    console.log("");
    if (state.winner) {
        console.log("  \x1b[33m★ WINNER: " + state.winner +
                    " in " + turns + " turns ★\x1b[0m");
    } else {
        console.log("  (No winner in " + MAX_TURNS + " turns)");
    }
    for (const p of state.players) {
        const status = p.alive ? (p.hand.length + " cards") : "ELIMINATED";
        console.log("  " + p.id + ": " + status);
    }
    if (eliminations > 0) {
        console.log("  Eliminations: " + eliminations);
    }

    assert(state.winner !== null, "Game produced a winner");
    assert(turns < MAX_TURNS, "Finished in " + turns + " turns");
}

// ============================================================================
//  Summary
// ============================================================================

console.log("\n\x1b[1m" + "═".repeat(50) + "\x1b[0m");
const color = _failed === 0 ? "\x1b[32m" : "\x1b[31m";
console.log("\x1b[1m  Results: " + color +
    _passed + " passed, " + _failed + " failed\x1b[0m");
console.log("\x1b[1m" + "═".repeat(50) + "\x1b[0m\n");

process.exit(_failed > 0 ? 1 : 0);
