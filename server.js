const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const app = require('express')();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Middleware configuration
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
    origin: true,
    credentials: true
}));

// Database connection pool
const pool = mysql.createPool({
    host: '46.28.44.5',
    user: 'vwsrv',
    password: 'Bgt56yhN@',
    database: 'vwsrv',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Helper function to get JSON files recursively
async function getJsonFilesRecursively(dir) {
    let results = [];
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                results = [...results, ...await getJsonFilesRecursively(fullPath)];
            } else if (file.name.endsWith('.json') && file.name.startsWith('screenshot_')) {
                // Only include files that are in a directory matching the hour pattern (e.g., "10-11")
                const parentDir = path.basename(path.dirname(fullPath));
                if (/^\d{2}-\d{2}$/.test(parentDir)) {
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    return results;
}

// Function to process screenshot files
// Function to process screenshot files
// Function to process screenshot files - FIXED VERSION
async function processScreenshotFiles() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        const files = await getJsonFilesRecursively(screenshotsDir);

        for (const filePath of files) {
            try {
                const fileContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);

                // Get the task data file path from the task directory
                const taskDataPath = path.join(
                    screenshotsDir,
                    `project_${jsonData.projectID}`,
                    `task_${jsonData.taskID}`,
                    `taskData_${jsonData.taskID}.json`
                );
                // Read task data
                let taskData = {};
                try {
                    const taskDataContent = await fs.readFile(taskDataPath, 'utf8');
                    taskData = JSON.parse(taskDataContent);
                } catch (error) {
                    console.warn('Task data file not found or unreadable:', taskDataPath);
                }

                // Fixed data mapping - use activeJSON instead of activeFlag
                const dataToSend = {
                    projectID: jsonData.projectID,
                    userID: jsonData.userID,
                    taskID: jsonData.taskID,
                    screenshotTimeStamp: jsonData.screenshotTimeStamp,
                    calcTimeStamp: jsonData.calcTimeStamp,
                    keyboardJSON: jsonData.keyboardJSON,
                    mouseJSON: jsonData.mouseJSON,
                    activeJSON: jsonData.activeJSON || {},
                    activeFlag: jsonData.activeFlag !== undefined ? jsonData.activeFlag : 1,
                    activeMins: jsonData.activeMins !== undefined ? jsonData.activeMins : 1,
                    deletedFlag: jsonData.deletedFlag !== undefined ? jsonData.deletedFlag : 0,
                    activeMemo: jsonData.activeMemo || '',
                    imageURL: jsonData.imageURL || '',
                    thumbnailURL: jsonData.thumbnailURL || '',
                    createdAt: jsonData.createdAt || new Date().toISOString(),
                    modifiedAt: jsonData.modifiedAT || jsonData.modifiedAt || new Date().toISOString()
                };

                try {
                    await axios.post(
                        'https://vw.aisrv.in/node_backend/postProjectV1',
                        dataToSend,
                        {
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );

                    console.log(`✅ Successfully processed ${filePath}`);
                } catch (error) {
                    console.error(`❌ Error processing ${filePath}:`, error.message);
                    if (error.response) {
                    }
                }
            } catch (error) {
                console.error('Error in processScreenshotFiles:', error);
            }
        }
    } catch (error) {
        console.error('Error in processScreenshotFiles:', error);
    }
}

// Function to initialize screenshot watcher
async function initScreenshotWatcher() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
    
    try {
        await fs.mkdir(screenshotsDir, { recursive: true });

        // Process existing files first
        await processScreenshotFiles();

        // Set up file watcher
        const chokidar = require('chokidar');
        const watcher = chokidar.watch(screenshotsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });

        watcher.on('add', async (filePath) => {
            if (filePath.endsWith('.json') && path.basename(filePath).startsWith('screenshot_')) {
                await processScreenshotFiles();
            }
        });

        watcher.on('error', error => {
            console.error('Watcher error:', error);
        });

    } catch (error) {
        console.error('Error setting up file watcher:', error);
    }
}

// POST endpoint configuration
// POST endpoint configuration
// POST endpoint configuration - FIXED VERSION
app.post('/node_backend/postProjectV1', async (req, res) => {
    let connection;
    
    try {
        const {
            projectID,
            userID,
            taskID,
            screenshotTimeStamp,
            calcTimeStamp,
            keyboardJSON,
            mouseJSON,
            activeJSON,
            imageURL,
            thumbnailURL,
            activeFlag,
            deletedFlag,
            activeMins  // Add this field that you're sending from processScreenshotFiles
        } = req.body;

        // Input validation with detailed logging
        const requiredFields = { projectID, userID, taskID };
        const missingFields = [];
        
        for (const [field, value] of Object.entries(requiredFields)) {
            if (value === undefined || value === null || value === '') {
                missingFields.push(field);
            }
        }

        if (missingFields.length > 0) {
            console.error('Missing required fields:', missingFields);
            console.error('Received data:', req.body);
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        connection = await pool.getConnection();

        // Fixed SQL query - removed extra placeholders
        const [result] = await connection.execute(`
            INSERT INTO workdiary 
            (projectID, userID, taskID, screenshotTimeStamp, calcTimeStamp, 
             keyboardJSON, mouseJSON, activeJSON, imageURL, thumbnailURL, activeFlag, 
             deletedFlag, createdAt, modifiedAT) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
            projectID,
            userID,
            taskID,
            screenshotTimeStamp ? new Date(screenshotTimeStamp) : new Date(),
            calcTimeStamp ? new Date(calcTimeStamp) : new Date(),
            JSON.stringify(keyboardJSON || {}),
            JSON.stringify(mouseJSON || {}),
            JSON.stringify(activeJSON || {}),
            imageURL || '',
            thumbnailURL || '',
            activeFlag !== undefined ? activeFlag : 1,
            deletedFlag !== undefined ? deletedFlag : 0
        ]);

        connection.release();

        res.json({
            success: true,
            insertedId: result.insertId,
            message: 'Workdiary entry created successfully'
        });

    } catch (error) {
        console.error('Database error:', error.message);
        console.error('Full error:', error);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET endpoint to fetch all workdiary entries
app.get('/node_backend/postProjectV1', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT * FROM workdiary ORDER BY screenshotTimeStamp DESC');
        connection.release();

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching workdiary entries:', error);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET endpoint to fetch specific workdiary entry
app.get('/node_backend/postProjectV1/:id', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT * FROM workdiary WHERE id = ?', [req.params.id]);
        connection.release();

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching workdiary entry:', error);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PATCH endpoint to update project
app.patch('/node_backend/postProjectV1/:id', async (req, res) => {
    let connection;
    try {
        const projectID = req.params.id;
        const { actHours, isExceeded } = req.body;


        if (!projectID) {
            return res.status(400).json({
                success: false,
                error: "projectID is required in URL"
            });
        }

        connection = await pool.getConnection();

        // Check if project exists
        const [projectRows] = await connection.execute(
            'SELECT id, name, actHours, estHours, wsID, modifiedAt FROM projects WHERE id = ?',
            [projectID]
        );

        if (projectRows.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Project with ID ${projectID} not found`
            });
        }

        const currentProject = projectRows[0];
        const newActHours = actHours !== undefined ? parseFloat(actHours) : currentProject.actHours;

        // Update the project
        const [updateResult] = await connection.execute(
            'UPDATE projects SET actHours = ?, modifiedAt = NOW() WHERE id = ?',
            [newActHours, projectID]
        );

        // Get updated data
        const [updatedProject] = await connection.execute(
            'SELECT id, name, actHours, estHours, wsID, modifiedAt FROM projects WHERE id = ?',
            [projectID]
        );

        connection.release();

        res.json({
            success: true,
            message: 'Project updated successfully',
            project: updatedProject[0]
        });

    } catch (error) {
        console.error('Error in PATCH /projects/:id:', error);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start server
app.listen(3101, () => {
    console.log('Backend running on https://vw.aisrv.in:3101');
    initScreenshotWatcher();
});