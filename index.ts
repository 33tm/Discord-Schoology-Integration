import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    Events,
    GatewayIntentBits,
    GuildBasedChannel,
    PermissionsBitField,
    time
} from "discord.js"
import {
    token,
    key,
    secret,
    origin,
    callback,
    privileged,
    alternates
} from "./config.json"

import SchoologyAPI from "schoologyapi"
import express from "express"
import cors from "cors"

const i2t = new Map<string, string>()
const tokens = new Map<string, { id: string, secret: string, guildId: string }>()

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const schoology = new SchoologyAPI(key, secret)

client.once(Events.ClientReady, () => console.log("Started"))

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton() && interaction.customId === "oauth") {
        const { guildId } = interaction
        if (!guildId) {
            await interaction.reply({ content: "Invalid context", ephemeral: true })
            return
        }

        const { id } = interaction.user
        const { key, secret } = await schoology
            .request("GET", "/oauth/request_token")
            .then(schoology.format)

        if (i2t.has(id)) tokens.delete(i2t.get(id)!)

        i2t.set(id, key)
        tokens.set(key, { id, secret, guildId })

        const expiration = Date.now() + 1000 * 60 * 10
        setTimeout(() => tokens.delete(key), 1000 * 60 * 10)

        await interaction.reply({
            content: `This link will expire at ${time(Math.floor(expiration / 1000))}.`,
            components: [
                // @ts-ignore
                new ActionRowBuilder()
                    .addComponents(new ButtonBuilder()
                        .setLabel("Continue with Schoology")
                        .setURL(`https://pausd.schoology.com/oauth/authorize?oauth_token=${key}&oauth_callback=${callback}`)
                        .setStyle(ButtonStyle.Link))
            ],
            ephemeral: true
        })
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
        if (!privileged.includes(parseInt(interaction.user.id))) {
            await interaction.reply({ content: "Insufficient permission", ephemeral: true })
            return
        }

        try {
            await interaction.channel?.send({
                components: [
                    // @ts-ignore
                    new ActionRowBuilder()
                        .addComponents(new ButtonBuilder()
                            .setCustomId("oauth")
                            .setLabel("Continue with Schoology")
                            .setStyle(ButtonStyle.Primary))
                ]
            })
        } catch {
            await interaction.reply({ content: "Insufficient permission to send in this channel", ephemeral: true })
        }
    }
})

client.login(token)

const app = express()

app.use(cors({ origin }), express.json())

app.post("/", async (req, res) => {
    const { key } = req.body
    if (!tokens.has(key))
        return res.json({ error: "Invalid URL!" })

    const { id, secret, guildId } = tokens.get(key)!
    tokens.delete(key)
    i2t.delete(id)

    const token = await schoology
        .request("GET", "/oauth/access_token", { key, secret })
        .then(schoology.format)

    const { api_uid: uid } = await schoology
        .request("GET", "/app-user-info", token)

    if (!uid)
        return res.json({ error: "Invalid Schoology state!" })

    const { section } = await schoology
        .request("GET", `/users/${uid}/sections`, token)

    if (!section.filter(({ id }) => id === "7410290916").length)
        return res.json({ error: "Not in class of 2027!" })

    const classes = section
        .map(({ section_title }) => {
            try {
                const [, period, name, teacher] = section_title
                    .match(/(.*) \(.* \d+ (.*)\) (.*)/)
                return { period, name, teacher }
            } catch {
                return
            }
        })
        .filter(Boolean)
        .filter(({ period }) => period >= 0 && period <= 8)

    const guild = client.guilds.cache.get(guildId)!
    const user = guild.members.cache.get(id)!

    user.roles.cache
        .filter(({ name }) => name.match(/\d [A-Z][a-z]+/))
        .forEach(async role => await user.roles.remove(role))

    classes.forEach(async ({ period, name, teacher }) => {
        const role = guild.roles.cache.find(({ name }) => name === `${period} ${teacher}`)
            || await guild.roles.create({ name: `${period} ${teacher}` })

        teacher = teacher.toLowerCase()
            .replaceAll(/\s/g, "-")
            .replaceAll(/[^a-z-]/g, "")

        const channel = guild.channels.cache.get(alternates[teacher])
            || guild.channels.cache.find(c => c.name === teacher)
            || await guild.channels.create({ name: teacher, type: ChannelType.GuildText })

        await channel.edit({
            permissionOverwrites: [
                {
                    id: role.id,
                    allow: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: guild.roles.everyone,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                }
            ]
        })

        await user.roles.add(role)
    })

    client.users.cache.get(id)?.send(`Your schedule was automatically detected as:\n\n${classes.map(({ period, name, teacher }) => `${period}. ${name} (${teacher})`).join("\n")}\n\nBother <@694669671466663957> if anything looks incorrect`)

    return res.json({ classes })
})

app.listen(5000)