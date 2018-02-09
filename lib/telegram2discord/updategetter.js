"use strict";

/**************************
 * Import important stuff *
 **************************/

const Application = require("../Application");
const EventEmitter = require("events").EventEmitter;

const DEFAULT_TIMEOUT = 60;	// seconds

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
 * Adds a longpolling update getter to a Telegram bot and mixes an event emitter into the bot
 *
 * @param {teleapiwrapper.BotAPI} bot	The bot to get updates for
 */
async function updateGetter(bot) {
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

			// Iterate over the updates
			updates.forEach((update) => {

				// Update the offset
				offset = update.update_id + 1;

				// Check what type of update this is
				if (update.message !== undefined || update.channel_post !== undefined) {
					// Extract the message. Treat ordinary messages and channel posts the same
					const message = update.message || update.channel_post;

					// Determine type
					if (message.text !== undefined) {
						emitter.emit("text", message);
					} else if (message.photo !== undefined) {
						emitter.emit("photo", message);
					} else if (message.document !== undefined) {
						emitter.emit("document", message);
					} else if (message.voice !== undefined) {
						emitter.emit("voice", message);
					} else if (message.audio !== undefined) {
						emitter.emit("audio", message);
					} else if (message.voice !== undefined) {
						emitter.emit("voice", message);
					} else if (message.video !== undefined) {
						emitter.emit("video", message);
					} else if (message.sticker !== undefined) {
						emitter.emit("sticker", message);
					}
				} else if (update.edited_message !== undefined) {
					// Extract the message
					const message = update.edited_message;

					// This is an update to a message
					emitter.emit("messageEdit", message);
				}
			});
		} catch (err) {
		  	 Application.logger.error("Couldn't fetch Telegram messages. Reason:", `${err.name}: ${err.message}` + Application.settings.debug ? err.stack : '');
		}

		// Do it again
		fetchUpdates();
	}

	// Mix the emitter into the bot
	for (const k in emitter) {
		bot[k] = emitter[k] instanceof Function ? emitter[k].bind(emitter) : emitter[k];
	}

	// Start the fetching
	if (Application.settings.telegram.skipOldMessages) {
		// Log the start of the clearing if debugging is on
		if (Application.settings.debug) {
			Application.logger.log("Clearing old Telegram messages");
		}

		// Start clearing messages
		const newOffset = await clearInitialUpdates(bot);

		// Set the correct offset
		offset = newOffset;

		// Log that the clearing has ended if debugging is on
		if (Application.settings.debug) {
			Application.logger.log("Old Telegram messages cleared");
		}
	}

	// Start the fetching
	fetchUpdates();
}

/***********************
 * Export the function *
 ***********************/

module.exports = updateGetter;
