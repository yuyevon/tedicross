"use strict";

/**************************
 * Import important stuff *
 **************************/

const Application = require("../Application");
const updateGetter = require("./updategetter");
const handleEntities = require("./handleEntities");
const messageConverter = require("./messageConverter");
const MessageMap = require("../MessageMap");
const _ = require("lodash");
const mime = require("mime/lite");

/**
 * Creates a function which sends files from Telegram to discord
 *
 * @param {BotAPI} tgBot	The Telegram bot
 * @param {Discord.Client} dcBot	The Discord bot
 * @param {DiscordUserMap} arg.dcUsers	A map between discord users and their IDs
 *
 * @returns {Function}	A function which can be used to send files from Telegram to Discord
 *
 * @private
 */
function makeFileSender(tgBot, dcBot, dcUsers) {
	/**
	 * Sends a file to Discord
	 *
	 * @param {String} arg.discordChannel Discord channel ID
	 * @param {Message} arg.message	Display name of the sender
	 * @param {String} arg.fileId	ID of the file to download from Telegram's servers
	 * @param {String} arg.fileName	Name of the file to send
	 * @param {String} [arg.caption]	Additional text to send with the file
	 * @param {Boolean} [arg.resolveExtension]	Set to true if the bot should try to find the file extension itself, in which case it will be appended to the file name. Defaults to false
	 */
	return async function({discordChannel, message, fileId, fileName, caption = "", resolveExtension = false}) {
		// Make the text to send
		const messageObj = messageConverter({ message, dcUsers, tgBot });
		const textToSend = `**${messageObj.from}**:\n${caption}`

		// Wait for the Discord bot to become ready
		await dcBot.ready;
		
		// Start getting the file
		const file = await tgBot.getFile({file_id: fileId});

		// Get the extension, if necessary
		let extension = "";
		if (resolveExtension) {
			extension = "." + file.file_path.split(".").pop();
		}
		const fileStream = await tgBot.helperGetFileStream(file);

		// Create an array of buffers to store the file in
		const buffers = [];

		// Fetch the file
		fileStream.on("data", (chunk) => {
			buffers.push(chunk);
		});

		return new Promise((resolve) => {
			// Send the file when it is fetched
			fileStream.on("end", async () => {
				const p = dcBot.channels.get(discordChannel).send(
					textToSend,
					{
						file: {
							attachment: Buffer.concat(buffers),
							name: fileName + extension
						}
					}
				);

				// Pass the promise back to the caller
				resolve(p);
			});
		});
	};
}


/**
 * Curryed function creating handlers handling messages which should not be relayed, and passing through those which should
 *
 * @param {BotAPI} tgBot	The Telegram bot
 * @param {Function} func	The message handler to wrap
 * @param {Message} message	The Telegram message triggering the wrapped function
 *
 * @private
 */
const createMessageHandler = _.curry(async (tgBot, func, message) => {
	if (message.text !== undefined && tgBot.me !== undefined && message.text.toLowerCase() === `@${tgBot.me.username} chatinfo`.toLowerCase()) {
		// This is a request for chat info. Give it, no matter which chat this is from
		tgBot.sendMessage({
			chat_id: message.chat.id,
			text: "chatID: " + message.chat.id
		});
	} else {
		// Check if the message came from the correct chat
		if (!Application.bridgeMap.has("telegram", message.chat.id)) {

			try {
				// Tell the sender that this is a private bot
				tgBot.sendMessage({
					chat_id: message.chat.id,
					text: "This is an instance of a [TediCross](https://github.com/Suppen/TediCross) bot, "
					  + "bridging a chat in Telegram with one in Discord. "
					  + "If you wish to use TediCross yourself, please download and create an instance. "
					  + "Join our [Telegram group](https://t.me/TediCrossSupport) or [Discord server](https://discord.gg/MfzGMzy) for help"
					,
					parse_mode: "markdown"
				});
			} catch (err) {
				// Hmm... Could not send the message for some reason...
				console.error("Could not tell user to get their own TediCross instance:", err, message);
			}
		} else {
			// Do the thing
			const bridge = Application.bridgeMap.getBridge("telegram", message.chat.id);
			func(message, bridge);
		}
	}
});

/**********************
 * The setup function *
 **********************/

/**
 * Sets up the receiving of Telegram messages, and relaying them to Discord
 *
 * @param {BotAPI} tgBot	The Telegram bot
 * @param {Discord.Client} dcBot	The Discord bot
 * @param {DiscordUserMap} dcUsers	A map between discord users and their IDs
 * @param {MessageMap} messageMap	Map between IDs of messages
 */
function setup(tgBot, dcBot, dcUsers, messageMap) {
	// Start longpolling
	updateGetter(tgBot, Application.settings);

	// Make the file sender
	const sendFile = makeFileSender(tgBot, dcBot, dcUsers);

	// Create the message handler wrapper
	const wrapFunction = createMessageHandler(tgBot);

	// Set up event listener for text messages from Telegram
	tgBot.on("text", wrapFunction(async (message, bridge) => {

		// Turn the text discord friendly
		const messageObj = messageConverter({ message, dcUsers, tgBot });

		try {
			// Pass it on to Discord when the dcBot is ready
			await dcBot.ready;
			const dcMessage = await dcBot.channels.get(bridge.discord.channel).send(messageObj.composed);

			// Make the mapping so future edits can work
			messageMap.insert(MessageMap.TELEGRAM_TO_DISCORD, message.message_id, dcMessage.id);
		} catch (err) {
			// Could not send it for some reason... Log it
			Application.logger.error(`[${bridge.name}] Discord did not accept a text message:`, err);
			Application.logger.error(`[${bridge.name}] Failed message:`, message.text);
		}
	}));

	// Set up event listener for photo messages from Telegram
	tgBot.on("photo", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.photo[message.photo.length-1].file_id,
				fileName: "photo.jpg",	// Telegram will convert it to jpg no matter what filetype is actually sent
				caption: message.caption
			});
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send photo`, err);
		}
	}));

	// Set up event listener for stickers from Telegram
	tgBot.on("sticker", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.sticker.thumb.file_id,
				fileName: "sticker.webp",	// Telegram will insist that it is a jpg, but it really is a webp
				caption: Application.settings.telegram.sendEmojiWithStickers ? message.sticker.emoji : undefined
			});
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send sticker`, err);
		}
	}));

	// Set up event listener for filetypes not caught by the other filetype handlers
	tgBot.on("document", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.document.file_id,
				fileName: message.document.file_name,
				resolveExtension: false
			});
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send document`, err);
		}
	}));

	// Set up event listener for voice messages
	tgBot.on("voice", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.voice.file_id,
				fileName: "voice" + "." + mime.getExtension(message.voice.mime_type),
				resolveExtension: false
			})
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send voice`, err);
		}
	}));

	// Set up event listener for audio messages
	tgBot.on("audio", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.audio.file_id,
				fileName: message.audio.title,
				resolveExtension: true
			})
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send audio`, err);
		}
	}));

	// Set up event listener for video messages
	tgBot.on("video", wrapFunction(async (message, bridge) => {
		try {
			await sendFile({
				discordChannel: bridge.discord.channel,
				message,
				fileId: message.video.file_id,
				fileName: "video" + "." + mime.getExtension(message.video.mime_type),
				resolveExtension: false
			})
		} catch (err) {
			Application.logger.error(`[${bridge.name}] Could not send video`, err);
		}
	}));

	// Set up event listener for message edits
	tgBot.on("messageEdit", wrapFunction(async (tgMessage, bridge) => {
		try {
			// Wait for the Discord bot to become ready
			await dcBot.ready;

			// Try to get the corresponding message in Discord
			const dcMessageId = messageMap.getCorresponding(MessageMap.TELEGRAM_TO_DISCORD, tgMessage.message_id);

			// Get the message from Discord
			const dcMessage = await dcBot.channels.get(bridge.discord.channel).fetchMessage(dcMessageId);

			// Turn the message more discord friendly
			const messageObj = messageConverter({ message: tgMessage, dcUsers, tgBot });

			// Try to edit the message
			await dcMessage.edit(messageObj.composed);
		} catch (err) {
			// Log it
			Application.logger.error(`[${bridge.name}] Could not edit Discord message:`, err);
		}
	}));

	// Make a promise which resolves when the tgBot is ready
	tgBot.ready = tgBot.getMe()
	  .then((bot) => {
		// Log the bot's info
		Application.logger.info(`Telegram: ${bot.username} (${bot.id})`);

		// Put the data on the bot
		tgBot.me = bot;
	  })
	  .catch((err) => {
		// Log the error(
		Application.logger.error("Failed at getting the Telegram bot's me-object:", err);

		// Pass it on
		throw err;
	  });
}

/*****************************
 * Export the setup function *
 *****************************/

module.exports = setup;
