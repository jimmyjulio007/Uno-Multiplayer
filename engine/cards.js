"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — Card Definitions & Deck Builder
// ============================================================================
//
//  Official 168-card deck (Mattel HWV18, ©2023).
//
//  Card shape:
//    { id, color, type, value?, drawValue? }
//
//  color : "red" | "green" | "blue" | "yellow" | "wild"
//
//  Colored types :
//    "number"        – 0-9
//    "skip"          – Skip next player
//    "reverse"       – Reverse direction (= skip in 2p)
//    "draw2"         – +2 (colored)
//    "draw4"         – +4 (colored!)
//    "discard_all"   – Discard all cards of this color
//    "skip_everyone" – Skip all opponents, play again
//
//  Wild types (color === "wild") :
//    "wild_reverse_draw4"  – Reverse + next draws 4 (2p special)
//    "wild_draw6"          – Next draws 6
//    "wild_draw10"         – Next draws 10
//    "wild_color_roulette" – Next picks color, draws from pile until match
//
//  drawValue : penalty amount (2, 4, 6, 10) for stacking rules
//
// ============================================================================

const COLORS = Object.freeze(["red", "green", "blue", "yellow"]);

// Penalty value for each draw card type (used in stacking rules)
const DRAW_VALUES = Object.freeze({
    draw2:               2,
    draw4:               4,
    wild_reverse_draw4:  4,
    wild_draw6:          6,
    wild_draw10:        10,
});

// How many copies of each card exist per color or globally
const ELIMINATION_THRESHOLD = 25;

let _cardUid = 0;

/**
 * Create a single card object.
 * Uses a monotonic counter that NEVER resets, so IDs are globally unique.
 */
function makeCard(color, type, value) {
    const drawValue = DRAW_VALUES[type] || 0;
    return Object.freeze({
        id:        "c" + (++_cardUid),
        color,
        type,
        value:     value !== undefined ? value : null,
        drawValue,
    });
}

/**
 * Is this card type a penalty card (+2, +4, +6, +10)?
 */
function isDrawCard(card) {
    return card.drawValue > 0;
}

/**
 * Is this card a wild (white) card?
 */
function isWild(card) {
    return card.color === "wild";
}

/**
 * Build the official 168-card UNO Show 'Em No Mercy deck.
 *
 * Per color (×4):
 *   1× 0,  3× each 1-9,  2× Skip,  2× Reverse,  2× +2,
 *   2× +4,  1× Discard All,  1× Skip Everyone
 *   = 1 + 27 + 2 + 2 + 2 + 2 + 1 + 1 = 38  →  ×4 = 152
 *
 * Wild (white):
 *   4× Reverse+4,  4× +6,  4× +10,  4× Color Roulette
 *   = 16
 *
 * Total = 168
 */
function buildDeck() {
    _cardUid = 0;
    const deck = [];

    for (const color of COLORS) {
        // 1× 0
        deck.push(makeCard(color, "number", 0));

        // 3× each of 1-9
        for (let n = 1; n <= 9; n++) {
            deck.push(makeCard(color, "number", n));
            deck.push(makeCard(color, "number", n));
            deck.push(makeCard(color, "number", n));
        }

        // 2× Skip
        deck.push(makeCard(color, "skip"));
        deck.push(makeCard(color, "skip"));

        // 2× Reverse
        deck.push(makeCard(color, "reverse"));
        deck.push(makeCard(color, "reverse"));

        // 2× +2
        deck.push(makeCard(color, "draw2"));
        deck.push(makeCard(color, "draw2"));

        // 2× +4 (COLORED — not wild!)
        deck.push(makeCard(color, "draw4"));
        deck.push(makeCard(color, "draw4"));

        // 1× Discard All
        deck.push(makeCard(color, "discard_all"));

        // 1× Skip Everyone
        deck.push(makeCard(color, "skip_everyone"));
    }

    // Wild (white) cards
    for (let i = 0; i < 4; i++) {
        deck.push(makeCard("wild", "wild_reverse_draw4"));
        deck.push(makeCard("wild", "wild_draw6"));
        deck.push(makeCard("wild", "wild_draw10"));
        deck.push(makeCard("wild", "wild_color_roulette"));
    }

    return deck;
}

/**
 * Fisher-Yates shuffle. Returns NEW array.
 * Accepts optional seeded RNG for deterministic tests.
 */
function shuffle(arr, rng) {
    const rand = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

/**
 * Pick a valid starting card from the draw pile.
 * Per rules: if first card is an action card, ignore it and flip next.
 * A valid starter is a colored number card.
 */
function pickStartingCard(drawPile) {
    for (let i = 0; i < drawPile.length; i++) {
        const card = drawPile[i];
        if (card.color !== "wild" && card.type === "number") {
            drawPile.splice(i, 1);
            return card;
        }
    }
    return drawPile.shift();
}

module.exports = {
    COLORS,
    DRAW_VALUES,
    ELIMINATION_THRESHOLD,
    makeCard,
    isDrawCard,
    isWild,
    buildDeck,
    shuffle,
    pickStartingCard,
};

