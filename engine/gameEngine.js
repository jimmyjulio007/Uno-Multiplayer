"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — Game Engine
// ============================================================================
//
//  Faithful implementation of the official Mattel HWV18 rules (2023).
//
//  All public functions:
//    - receive current GameState + action params
//    - return NEW GameState (immutable)
//    - throw on illegal moves
//
//  pendingAction values:
//    null                    – normal play
//    "stack"                 – must stack (>= lastDrawValue) or resolve
//    "swap_pick"             – must pick swap target (card 7)
//    "color_roulette_pick"   – victim must pick a color for roulette
//
// ============================================================================

const { buildDeck, shuffle, pickStartingCard, COLORS,
        DRAW_VALUES, isDrawCard, isWild, ELIMINATION_THRESHOLD } = require("./cards");
const {
    cloneState, currentPlayer, findPlayer, findPlayerIndex,
    aliveCount, aliveIndices, topDiscard,
    reshuffleIfNeeded, drawCards, nextAliveIndex, advancePlayer,
} = require("./gameState");

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_HAND_SIZE = 7;
const UNO_PENALTY = 2;  // Official: 2 cards if caught not saying UNO

// ─── 1. initGame ────────────────────────────────────────────────────────────

/**
 * Create a fresh game.
 * @param {string[]} playerIds – 2-6 players
 * @param {Function}  [rng]   – optional seeded RNG
 */
function initGame(playerIds, rng) {
    if (playerIds.length < 2 || playerIds.length > 6) {
        throw new Error("UNO No Mercy requires 2-6 players");
    }

    const deck = shuffle(buildDeck(), rng);

    const players = playerIds.map(id => ({
        id,
        hand:    [],
        saidUno: false,
        alive:   true,
    }));

    let drawPile = deck.slice();

    // Deal 7 cards each
    for (let i = 0; i < INITIAL_HAND_SIZE; i++) {
        for (const player of players) {
            player.hand.push(drawPile.pop());
        }
    }

    // Valid starting card = colored number (skip action cards per rules)
    const startCard = pickStartingCard(drawPile);

    return {
        players,
        drawPile,
        discardPile:        [startCard],
        eliminatedCards:    [],
        currentPlayerIndex: 0,
        direction:          1,
        currentColor:       startCard.color,
        stackValue:         0,
        lastDrawValue:      0,
        pendingAction:      null,
        winner:             null,
        lastPlayedCard:     startCard,
        lastPlayerId:       null,
        _previousColor:     null,
    };
}

// ─── 2. getPlayableCards ────────────────────────────────────────────────────

/**
 * Which cards in a player's hand are legally playable?
 *
 * During a stack: only +X cards with drawValue >= lastDrawValue.
 * Normal play: match color, number, type, or play a wild.
 */
function getPlayableCards(player, state) {
    // During stacking: only draw cards with value >= last
    if (state.pendingAction === "stack") {
        return player.hand.filter(c =>
            isDrawCard(c) && c.drawValue >= state.lastDrawValue
        );
    }

    // During roulette or swap pick: nothing playable
    if (state.pendingAction === "color_roulette_pick" ||
        state.pendingAction === "swap_pick") {
        return [];
    }

    const top = topDiscard(state);
    const color = state.currentColor;

    return player.hand.filter(c => isCardPlayable(c, top, color));
}

/**
 * Can this card be legally played on top of the current discard?
 */
function isCardPlayable(card, topCard, activeColor) {
    // Wild cards are always playable
    if (isWild(card)) return true;

    // Same active color
    if (card.color === activeColor) return true;

    // Same number across colors
    if (card.type === "number" && topCard.type === "number" &&
        card.value === topCard.value) return true;

    // Same action type across colors
    if (card.type !== "number" && card.type === topCard.type) return true;

    return false;
}

// ─── 3. playCard ────────────────────────────────────────────────────────────

/**
 * Play a card from the current player's hand.
 *
 * @param {object}  state
 * @param {string}  playerId
 * @param {string}  cardId
 * @param {string}  [chosenColor]    – required for wild cards
 * @param {string}  [swapTargetId]   – for card 7
 * @returns {object} new GameState
 */
function playCard(state, playerId, cardId, chosenColor, swapTargetId) {
    const cp = currentPlayer(state);
    if (cp.id !== playerId) {
        throw new Error("Not your turn. Current: " + cp.id);
    }
    if (state.winner) throw new Error("Game is over");
    if (!cp.alive) throw new Error("Player is eliminated");

    const cardIdx = cp.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) throw new Error("Card not in hand");

    const card = cp.hand[cardIdx];

    // Legality check
    const playable = getPlayableCards(cp, state);
    if (!playable.find(c => c.id === cardId)) {
        throw new Error("Card not playable: " + card.type + " " + card.color);
    }

    // Wild cards require color choice
    if (isWild(card) && !chosenColor) {
        throw new Error("Must choose a color for wild card");
    }
    if (chosenColor && !COLORS.includes(chosenColor)) {
        throw new Error("Invalid color: " + chosenColor);
    }

    // ── Apply ───────────────────────────────────────────────────────
    let s = cloneState(state);
    const playerIdx = findPlayerIndex(s, playerId);
    const player = s.players[playerIdx];

    // Remove card from hand
    player.hand.splice(cardIdx, 1);

    // Place on discard
    s.discardPile.push(card);
    s.lastPlayedCard = card;
    s.lastPlayerId = playerId;

    // Save previous color (for reference)
    s._previousColor = state.currentColor;

    // Update active color
    if (isWild(card)) {
        s.currentColor = chosenColor;
    } else {
        s.currentColor = card.color;
    }

    // Reset saidUno flag if hand isn't 1
    if (player.hand.length !== 1) {
        player.saidUno = false;
    }

    // ── Check win (empty hand) ──────────────────────────────────────
    if (player.hand.length === 0) {
        s.winner = playerId;
        return s;
    }

    // ── Apply card effect ───────────────────────────────────────────
    s = applyCardEffect(s, card, playerIdx, swapTargetId);

    // ── Check for last-player-standing win ──────────────────────────
    s = checkLastStanding(s);

    return s;
}

// ─── 4. drawCard (draw until playable) ──────────────────────────────────────

/**
 * Current player draws from pile UNTIL they get a playable card.
 * Per official rules: "draw until you can play, then play it".
 *
 * Returns { state, drawnCards, playableCard }.
 * The playableCard can then be played via playCard, or the turn auto-advances
 * if no card could be drawn (pile exhausted).
 */
function drawUntilPlayable(state, playerId) {
    const cp = currentPlayer(state);
    if (cp.id !== playerId) throw new Error("Not your turn");
    if (state.winner) throw new Error("Game is over");

    if (state.pendingAction === "stack") {
        throw new Error("Must resolve or stack the penalty");
    }

    let s = cloneState(state);
    const playerIdx = findPlayerIndex(s, playerId);
    const drawnCards = [];
    let playableCard = null;

    // Keep drawing until we find a playable card or pile runs out
    const maxDraw = 168; // safety limit
    for (let i = 0; i < maxDraw; i++) {
        s = reshuffleIfNeeded(s);
        if (s.drawPile.length === 0) break;

        const drawn = s.drawPile.pop();
        s.players[playerIdx].hand.push(drawn);
        s.players[playerIdx].saidUno = false;
        drawnCards.push(drawn);

        // Check if this card is playable
        if (isCardPlayable(drawn, topDiscard(s), s.currentColor)) {
            playableCard = drawn;
            break;
        }
    }

    // Check elimination after drawing many cards
    const { checkElimination } = require("./gameState");
    s = checkElimination(s, playerIdx);

    // If player was eliminated or no playable card found, advance turn
    if (!s.players[playerIdx].alive || !playableCard) {
        s = advancePlayer(s);
        s = checkLastStanding(s);
        return { state: s, drawnCards, playableCard: null };
    }

    // Player has a playable card — they must play it (per rules)
    // We return it so the caller can issue a playCard call
    return { state: s, drawnCards, playableCard };
}

// ─── 5. resolveStack ────────────────────────────────────────────────────────

/**
 * Player accepts the accumulated penalty: draws stackValue cards.
 */
function resolveStack(state, playerId) {
    const cp = currentPlayer(state);
    if (cp.id !== playerId) throw new Error("Not your turn");
    if (state.pendingAction !== "stack") throw new Error("No stack to resolve");

    let s = cloneState(state);
    const playerIdx = findPlayerIndex(s, playerId);

    s = drawCards(s, playerIdx, s.stackValue);
    s.stackValue = 0;
    s.lastDrawValue = 0;
    s.pendingAction = null;

    s = advancePlayer(s);
    s = checkLastStanding(s);
    return s;
}

// ─── 6. Color Roulette resolution ───────────────────────────────────────────

/**
 * Victim picks a color for the Color Roulette.
 * Then draws cards from pile one-by-one until a card of that color appears.
 * White/wild cards do NOT count as a match.
 */
function resolveColorRoulette(state, playerId, chosenColor) {
    const cp = currentPlayer(state);
    if (cp.id !== playerId) throw new Error("Not your turn");
    if (state.pendingAction !== "color_roulette_pick") {
        throw new Error("No color roulette pending");
    }
    if (!COLORS.includes(chosenColor)) {
        throw new Error("Invalid color: " + chosenColor);
    }

    let s = cloneState(state);
    const playerIdx = findPlayerIndex(s, playerId);
    const revealedCards = [];

    const maxDraw = 168;
    for (let i = 0; i < maxDraw; i++) {
        s = reshuffleIfNeeded(s);
        if (s.drawPile.length === 0) break;

        const drawn = s.drawPile.pop();
        revealedCards.push(drawn);
        s.players[playerIdx].hand.push(drawn);

        // Match: colored card of the chosen color (white doesn't count)
        if (drawn.color === chosenColor) {
            break;
        }
    }

    s.players[playerIdx].saidUno = false;
    s.pendingAction = null;

    // Check elimination
    const { checkElimination } = require("./gameState");
    s = checkElimination(s, playerIdx);

    // Turn consumed — advance
    s = advancePlayer(s);
    s = checkLastStanding(s);

    return { state: s, revealedCards };
}

// ─── 7. nextPlayer ──────────────────────────────────────────────────────────

function nextPlayer(state) {
    return nextAliveIndex(state, state.currentPlayerIndex, 1);
}

// ─── 8. applyCardEffect ────────────────────────────────────────────────────

/**
 * Apply the effect of a card just played.
 */
function applyCardEffect(state, card, playerIdx, swapTargetId) {
    let s = state;
    const n = aliveCount(s);

    switch (card.type) {

        // ── SKIP ────────────────────────────────────────────────────
        case "skip":
            s = advancePlayer(s, 2); // skip 1 alive player
            break;

        // ── REVERSE ─────────────────────────────────────────────────
        case "reverse":
            s.direction *= -1;
            if (n === 2) {
                // 2-player: acts as skip → play again
                s = advancePlayer(s, 2);
            } else {
                s = advancePlayer(s);
            }
            break;

        // ── +2 (colored) ────────────────────────────────────────────
        case "draw2":
            s.stackValue += 2;
            s.lastDrawValue = 2;
            s.pendingAction = "stack";
            s = advancePlayer(s);
            break;

        // ── +4 (colored!) ───────────────────────────────────────────
        case "draw4":
            s.stackValue += 4;
            s.lastDrawValue = 4;
            s.pendingAction = "stack";
            s = advancePlayer(s);
            break;

        // ── DISCARD ALL ─────────────────────────────────────────────
        // Player discards all cards matching the card's color.
        case "discard_all": {
            const player = s.players[playerIdx];
            const color = card.color;
            const kept = [];
            for (const c of player.hand) {
                if (c.color === color) {
                    s.discardPile.push(c);
                } else {
                    kept.push(c);
                }
            }
            player.hand = kept;

            // Check if player won by emptying hand
            if (player.hand.length === 0) {
                s.winner = player.id;
                return s;
            }
            s = advancePlayer(s);
            break;
        }

        // ── SKIP EVERYONE ───────────────────────────────────────────
        // Skip all opponents, player plays again.
        case "skip_everyone":
            // Don't advance — current player plays again
            break;

        // ── WILD REVERSE +4 ────────────────────────────────────────
        case "wild_reverse_draw4":
            s.direction *= -1;

            if (n === 2) {
                // 2-player special: opponent passes, but the PLAYER WHO
                // PLAYED IT draws 4!  They can then use stacking.
                s = drawCards(s, playerIdx, 4);
                if (!s.players[playerIdx].alive) break; // eliminated

                // Player can use stacking to pass penalty to opponent.
                // We model this by putting a stack on the current player.
                // Actually re-reading the rule: "il peut utiliser la règle
                // Pénalité augmentée pour que la pénalité passe à l'autre joueur"
                // So the player who drew can then play a +X card to redirect.
                // We implement this as: stack of 4 on current player,
                // pending action = stack, and it's still their turn.
                s.stackValue = 4;
                s.lastDrawValue = 4;
                s.pendingAction = "stack";
                // Current player stays (they get to respond to their own penalty)
                break;
            }

            // Normal (3+ players): reverse + next draws 4
            s.stackValue += 4;
            s.lastDrawValue = 4;
            s.pendingAction = "stack";
            s = advancePlayer(s);
            break;

        // ── WILD +6 ────────────────────────────────────────────────
        case "wild_draw6":
            s.stackValue += 6;
            s.lastDrawValue = 6;
            s.pendingAction = "stack";
            s = advancePlayer(s);
            break;

        // ── WILD +10 ───────────────────────────────────────────────
        case "wild_draw10":
            s.stackValue += 10;
            s.lastDrawValue = 10;
            s.pendingAction = "stack";
            s = advancePlayer(s);
            break;

        // ── WILD COLOR ROULETTE ────────────────────────────────────
        case "wild_color_roulette":
            s.pendingAction = "color_roulette_pick";
            s = advancePlayer(s);
            // Next player must choose a color (resolveColorRoulette)
            break;

        // ── NUMBER CARDS ────────────────────────────────────────────
        case "number":
            if (card.value === 0) {
                // Rule of 0: rotate all hands
                s = applyRotateHands(s);
                s = advancePlayer(s);
            } else if (card.value === 7) {
                // Rule of 7: MUST swap with chosen player
                if (swapTargetId) {
                    s = applySwapHands(s, s.lastPlayerId, swapTargetId);
                    s = advancePlayer(s);
                } else {
                    s.pendingAction = "swap_pick";
                    // Don't advance: player must pick target
                }
            } else {
                s = advancePlayer(s);
            }
            break;

        default:
            s = advancePlayer(s);
    }

    return s;
}

// ─── Rotate hands (card 0) ─────────────────────────────────────────────────

/**
 * Per rules: "tous les joueurs doivent passer leurs cartes en main
 * au joueur suivant dans le sens du jeu."
 *
 * Each player gives their hand to the next player in play direction.
 */
function applyRotateHands(state) {
    const alive = aliveIndices(state);
    if (alive.length < 2) return state;

    const saved = {};
    for (const idx of alive) {
        saved[idx] = state.players[idx].hand.slice();
    }

    // In play direction: each player receives the hand of the PREVIOUS alive player
    for (let i = 0; i < alive.length; i++) {
        const receiverIdx = alive[i];
        // Previous in direction
        const prevI = ((i - state.direction) % alive.length + alive.length) % alive.length;
        const giverIdx = alive[prevI];
        state.players[receiverIdx].hand = saved[giverIdx];
        state.players[receiverIdx].saidUno = false;
    }

    // Check elimination for everyone
    const { checkElimination } = require("./gameState");
    for (const idx of alive) {
        state = checkElimination(state, idx);
    }

    return state;
}

// ─── Swap hands (card 7) ───────────────────────────────────────────────────

function applySwapHands(state, sourceId, targetId) {
    const si = findPlayerIndex(state, sourceId);
    const ti = findPlayerIndex(state, targetId);
    if (si === -1 || ti === -1) throw new Error("Invalid swap target");
    if (si === ti) throw new Error("Cannot swap with yourself");
    if (!state.players[ti].alive) throw new Error("Cannot swap with eliminated player");

    const tmp = state.players[si].hand;
    state.players[si].hand = state.players[ti].hand;
    state.players[ti].hand = tmp;
    state.players[si].saidUno = false;
    state.players[ti].saidUno = false;

    // Check elimination for both
    const { checkElimination } = require("./gameState");
    state = checkElimination(state, si);
    state = checkElimination(state, ti);

    return state;
}

/**
 * Complete a pending swap (card 7).
 */
function completeSwap(state, playerId, swapTargetId) {
    if (state.pendingAction !== "swap_pick") {
        throw new Error("No swap pending");
    }
    if (state.lastPlayerId !== playerId) {
        throw new Error("Only the card-7 player can pick target");
    }

    let s = cloneState(state);
    s = applySwapHands(s, playerId, swapTargetId);
    s.pendingAction = null;
    s = advancePlayer(s);
    s = checkLastStanding(s);
    return s;
}

// ─── 9. UNO system ──────────────────────────────────────────────────────────

/**
 * Player declares "UNO!".
 */
function sayUno(state, playerId) {
    let s = cloneState(state);
    const idx = findPlayerIndex(s, playerId);
    if (idx === -1) throw new Error("Player not found");
    s.players[idx].saidUno = true;
    return s;
}

/**
 * Call out someone for not saying UNO.
 * Official rule: caught = draw 2.
 */
function callOutUno(state, callerId, targetId) {
    let s = cloneState(state);
    const targetIdx = findPlayerIndex(s, targetId);
    if (targetIdx === -1) throw new Error("Target not found");

    const target = s.players[targetIdx];
    if (target.hand.length === 1 && !target.saidUno && target.alive) {
        s = drawCards(s, targetIdx, UNO_PENALTY);
        s = checkLastStanding(s);
        return { state: s, success: true };
    }
    return { state: s, success: false };
}

// ─── 10. Win conditions ─────────────────────────────────────────────────────

/**
 * Check if only one player remains alive → they win.
 */
function checkLastStanding(state) {
    if (state.winner) return state;

    const alive = state.players.filter(p => p.alive);
    if (alive.length === 1) {
        state.winner = alive[0].id;
    }
    return state;
}

/**
 * Check if any player has 0 cards → they win.
 */
function checkWinner(state) {
    if (state.winner) return state;
    for (const p of state.players) {
        if (p.alive && p.hand.length === 0) {
            state.winner = p.id;
            return state;
        }
    }
    return checkLastStanding(state);
}

// ============================================================================
//  Exports
// ============================================================================

module.exports = {
    INITIAL_HAND_SIZE,
    UNO_PENALTY,

    initGame,
    getPlayableCards,
    isCardPlayable,
    playCard,
    drawUntilPlayable,
    resolveStack,
    resolveColorRoulette,
    nextPlayer,
    applyCardEffect,
    completeSwap,

    sayUno,
    callOutUno,

    checkWinner,
    checkLastStanding,

    applyRotateHands,
    applySwapHands,
};
