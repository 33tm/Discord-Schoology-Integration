import {
    SlashCommandBuilder,
    REST,
    Routes
} from "discord.js"

import { id, token } from "./config.json"

const commands = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Setup class verification in this channel")
]

await new REST()
    .setToken(token)
    .put(Routes.applicationCommands(id), {
        body: commands.map(command => command.toJSON())
    })