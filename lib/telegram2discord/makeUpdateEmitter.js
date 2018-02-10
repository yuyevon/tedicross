"use strict";

/**************************
 * Import important stuff *
 **************************/

const Application = require("../Application");
const moment = require("moment");
const { EventEmitter } = require("events");
const { handleUpdates } = require("./handleUpdates");

const DEFAULT_TIMEOUT = moment.duration(1, "minute").asSeconds();

/*****************************
 * The UpdateGetter function *
 *****************************/

/**
 * Runs getUpdates until there are no more updates to get. This is meant to run
 * at the startup of the bot to remove initial cached messages if the bot has
 * been down for a while. Returns a promise that resolves to the offset of the
 * latest cleared message.
 *
 * @param {teleapiwrapper.BotAPI} bot	The bot to get updates for
 * @param {Integer} offset	Initial offset. Same applies to this as timeout
 *
 * @returns {Integer}	The offset to use to get new messages
 *
 * @private
 */
async function clearInitialUpdates(bot, offset = 0) {
	// Get updates for the bot
	const updates = await bot.getUpdates({offset, timeout: 0});

	// Hold the newest offset
	let newestOffset = offset;

	// Have all old updates been fetched?
	if (updates.length !== 0) {
		// Nope. Run it again
		const newOffset = updates[updates.length - 1].update_id + 1;
		newestOffset = await clearInitialUpdates(bot, newOffset);
	}

	return newestOffset;
}

/**
 * Creates an event emitter emitting update events for a Telegram bot
 *
 * @param {teleapiwrapper.BotAPI} bot	The bot to get updates for
 *
 * @returns {EventEmitter}	The event emitter
 */
async function makeUpdateEmitter(bot) {
	// Create an event emitter
	const emitter = new EventEmitter();

	// Offset for which updates to fetch
	let offset = 0;

	// Function to fetch updates
	async function fetchUpdates() {
		// Log the event if debugging is on
		if (Application.settings.debug) {
			Application.logger.log("Fetching Telegram updates");
		}

		try {
			// Do the fetching
			const updates = await bot.getUpdates({offset, timeout: DEFAULT_TIMEOUT});

			// Process them and get the new offset
			offset = handleUpdates(updates, emitter) + 1;
		} catch (err) {
			// Could not get updates... Probably some network error
			Application.logger.error("Couldn't fetch Telegram messages. Reason:", `${err.name}: ${err.message}` + Application.settings.debug ? err.stack : '');
		}
		
		// Do it again. XXX DO NOT await this
		fetchUpdates();
	}

	// Clear old messages, if wanted
	if (Application.settings.telegram.skipOldMessages) {
		// Log the start of the clearing if debugging is on
		if (Application.settings.debug) {
			Application.logger.log("Clearing old Telegram messages");
		}

		// Clear messages and set the correct offset
		offset = await clearInitialUpdates(bot);

		// Log that the clearing has ended if debugging is on
		if (Application.settings.debug) {
			Application.logger.log("Old Telegram messages cleared");
		}
	}

	// Start the fetching. XXX DO NOT await this
	fetchUpdates();

	// Return the event emitter
	return emitter;
}

/***********************
 * Export the function *
 ***********************/

module.exports = makeUpdateEmitter;
