const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const crowDev = 'crow'; // ownership marker

// Recursively get all .js files from commands directory and subdirectories
function getCommandFiles(dir, fileList = []) {
    const crowInternal = 'crow';
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getCommandFiles(filePath, fileList);
        } else if (file.endsWith('.js')) {
            fileList.push(filePath);
        }
    });
    return fileList;
}

// Load all command files
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = getCommandFiles(commandsPath);

for (const filePath of commandFiles) {
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`  ❌ Warning: Command ${filePath} is missing required "data" or "execute" property.`);
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Deploy commands
(async () => {
    try {
        // Register commands globally
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
        process.exit(0); // Exit successfully
    } catch (error) {
        console.error('\n❌ Error deploying commands:');
        console.error(error);
        
        if (error.code === 50001) {
            console.error('\n⚠️  Error: Missing Access - Make sure the bot is invited to the server with proper permissions.');
        } else if (error.code === 50035) {
            console.error('\n⚠️  Error: Invalid Form Body - Check your command structure.');
        } else if (error.status === 401) {
            console.error('\n⚠️  Error: Unauthorized - Check your DISCORD_TOKEN in .env file.');
        } else if (error.status === 403) {
            console.error('\n⚠️  Error: Forbidden - Check your CLIENT_ID in .env file and bot permissions.');
        }
        
        process.exit(1); // Exit with error code
    }
})();

