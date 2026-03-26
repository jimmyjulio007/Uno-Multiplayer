"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — Game Reducer
// ============================================================================

const engine = require("./gameEngine");

const ActionTypes = Object.freeze({
    PLAY_CARD:          "PLAY_CARD",
    DRAW_UNTIL_PLAY:    "DRAW_UNTIL_PLAY",
    RESOLVE_STACK:      "RESOLVE_STACK",
    COLOR_ROULETTE:     "COLOR_ROULETTE",
    COMPLETE_SWAP:      "COMPLETE_SWAP",
    SAY_UNO:            "SAY_UNO",
    CALL_OUT_UNO:       "CALL_OUT_UNO",
});

/**
 * Single dispatch point for all game actions.
 *
 * @param {object} state
 * @param {object} action – { type, playerId, ... }
 * @returns {object}
 */
function gameReducer(state, action) {
    if (state.winner && action.type !== "SAY_UNO") {
        return state; // game over, no-op
    }

    switch (action.type) {

        // { type, playerId, cardId, chosenColor?, swapTargetId? }
        case ActionTypes.PLAY_CARD:
            return engine.playCard(
                state, action.playerId, action.cardId,
                action.chosenColor || null,
                action.swapTargetId || null,
            );

        // { type, playerId }
        case ActionTypes.DRAW_UNTIL_PLAY:
            return engine.drawUntilPlayable(state, action.playerId);
            // Returns { state, drawnCards, playableCard }

        // { type, playerId }
        case ActionTypes.RESOLVE_STACK:
            return engine.resolveStack(state, action.playerId);

        // { type, playerId, chosenColor }
        case ActionTypes.COLOR_ROULETTE:
            return engine.resolveColorRoulette(
                state, action.playerId, action.chosenColor
            );
            // Returns { state, revealedCards }

        // { type, playerId, swapTargetId }
        case ActionTypes.COMPLETE_SWAP:
            return engine.completeSwap(state, action.playerId, action.swapTargetId);

        // { type, playerId }
        case ActionTypes.SAY_UNO:
            return engine.sayUno(state, action.playerId);

        // { type, playerId, targetId }
        case ActionTypes.CALL_OUT_UNO:
            return engine.callOutUno(state, action.playerId, action.targetId);
            // Returns { state, success }

        default:
            throw new Error("Unknown action: " + action.type);
    }
}

module.exports = { gameReducer, ActionTypes };
