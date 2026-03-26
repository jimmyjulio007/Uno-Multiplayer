"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — State helpers (pure, immutable)
// ============================================================================

const { shuffle, ELIMINATION_THRESHOLD } = require("./cards");

/**
 * Deep-clone a GameState.
 * Cards are frozen objects so shallow copy of arrays is enough.
 */
function cloneState(state) {
    return {
        players:            state.players.map(p => ({
            id:       p.id,
            hand:     p.hand.slice(),
            saidUno:  p.saidUno,
            alive:    p.alive,
        })),
        drawPile:           state.drawPile.slice(),
        discardPile:        state.discardPile.slice(),
        eliminatedCards:    state.eliminatedCards ? state.eliminatedCards.slice() : [],
        currentPlayerIndex: state.currentPlayerIndex,
        direction:          state.direction,
        currentColor:       state.currentColor,
        stackValue:         state.stackValue,        // accumulated +X total
        lastDrawValue:      state.lastDrawValue,     // value of last +X played (for >= rule)
        pendingAction:      state.pendingAction || null,
        winner:             state.winner || null,
        lastPlayedCard:     state.lastPlayedCard || null,
        lastPlayerId:       state.lastPlayerId || null,
        _previousColor:     state._previousColor || null,
    };
}

/** Get the current player. */
function currentPlayer(state) {
    return state.players[state.currentPlayerIndex];
}

/** Find player by ID. */
function findPlayer(state, playerId) {
    return state.players.find(p => p.id === playerId) || null;
}

/** Find player index by ID. */
function findPlayerIndex(state, playerId) {
    return state.players.findIndex(p => p.id === playerId);
}

/** Count alive players. */
function aliveCount(state) {
    return state.players.filter(p => p.alive).length;
}

/** Get array of alive player indices. */
function aliveIndices(state) {
    const result = [];
    for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].alive) result.push(i);
    }
    return result;
}

/** Top card of the discard pile. */
function topDiscard(state) {
    return state.discardPile[state.discardPile.length - 1];
}

/**
 * Reshuffle when draw pile is empty.
 * Keeps top discard in place. Also folds in eliminatedCards.
 */
function reshuffleIfNeeded(state) {
    if (state.drawPile.length > 0) return state;

    const top = state.discardPile.pop();
    const pool = state.discardPile.concat(state.eliminatedCards || []);
    state.drawPile = shuffle(pool);
    state.discardPile = top ? [top] : [];
    state.eliminatedCards = [];

    return state;
}

/**
 * Draw N cards from draw pile into a player's hand.
 * Reshuffles automatically. After drawing, checks elimination.
 */
function drawCards(state, playerIdx, count) {
    for (let i = 0; i < count; i++) {
        state = reshuffleIfNeeded(state);
        if (state.drawPile.length === 0) break;
        state.players[playerIdx].hand.push(state.drawPile.pop());
    }
    state.players[playerIdx].saidUno = false;

    // Check elimination (25+ cards)
    state = checkElimination(state, playerIdx);

    return state;
}

/**
 * Eliminate a player if they have 25+ cards.
 * Their cards go to eliminatedCards pool.
 */
function checkElimination(state, playerIdx) {
    const player = state.players[playerIdx];
    if (!player.alive) return state;

    if (player.hand.length >= ELIMINATION_THRESHOLD) {
        // Eliminated!
        state.eliminatedCards = (state.eliminatedCards || []).concat(player.hand);
        player.hand = [];
        player.alive = false;

        // If current player was eliminated, advance will handle it
    }
    return state;
}

/**
 * Compute the next alive player index, advancing `skip` positions.
 */
function nextAliveIndex(state, fromIndex, skip) {
    const n = state.players.length;
    const dir = state.direction;
    let steps = skip !== undefined ? skip : 1;
    let idx = fromIndex;

    while (steps > 0) {
        idx = ((idx + dir) % n + n) % n;
        if (state.players[idx].alive) {
            steps--;
        }
        // Safety: if we loop all the way around, break
        if (idx === fromIndex && steps > 0) break;
    }
    return idx;
}

/**
 * Advance to the next alive player.
 */
function advancePlayer(state, skip) {
    state.currentPlayerIndex = nextAliveIndex(
        state, state.currentPlayerIndex, skip !== undefined ? skip : 1
    );
    return state;
}

module.exports = {
    cloneState,
    currentPlayer,
    findPlayer,
    findPlayerIndex,
    aliveCount,
    aliveIndices,
    topDiscard,
    reshuffleIfNeeded,
    drawCards,
    checkElimination,
    nextAliveIndex,
    advancePlayer,
};
