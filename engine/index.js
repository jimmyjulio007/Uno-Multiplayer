"use strict";

// ============================================================================
//  UNO SHOW 'EM NO MERCY — Barrel export
// ============================================================================

const cards = require("./cards");
const gameState = require("./gameState");
const gameEngine = require("./gameEngine");
const { gameReducer, ActionTypes } = require("./gameReducer");

module.exports = {
    ...cards,
    ...gameState,
    ...gameEngine,
    gameReducer,
    ActionTypes,
};
