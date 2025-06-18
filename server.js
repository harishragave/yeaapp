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


app.post('/node_backend/postProjectV1', async (req, res) => {
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
            activeFlag,
            activeMins,
            deletedFlag,
            activeMemo,
            imageURL,
            thumbNailURL
        } = req.body;

        // Validate required fields
        if (!imageURL || !thumbNailURL || !projectID || !userID || !taskID) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate base64 image format
        const screenshotMatch = imageURL.match(/^data:image\/(png|jpeg|jpg);base64,(.*)$/);
        const thumbnailMatch = thumbNailURL.match(/^data:image\/(png|jpeg|jpg);base64,(.*)$/);

        if (!screenshotMatch || !thumbnailMatch) {
            return res.status(400).json({ error: 'Invalid base64 image format' });
        }

        // Insert into database
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(`
                INSERT INTO workdiary 
                (projectID, userID, taskID, screenshotTimeStamp, calcTimeStamp, 
                 keyboardJSON, mouseJSON, activeJSON, activeFlag, activeMins, 
                 deletedFlag, activeMemo, imageURL, thumbNailURL, createdAt, modifiedAT) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                projectID,
                userID,
                taskID,
                screenshotTimeStamp ? new Date(screenshotTimeStamp) : new Date(),
                calcTimeStamp ? new Date(calcTimeStamp) : new Date(),
                JSON.stringify(keyboardJSON || {}),
                JSON.stringify(mouseJSON || {}),
                JSON.stringify(activeJSON || {}),
                activeFlag !== undefined ? activeFlag : 1,
                activeMins !== undefined ? activeMins : 0,
                deletedFlag !== undefined ? deletedFlag : 0,
                activeMemo || '',
                imageURL,
                thumbNailURL
            ]);

            res.json({
                success: true,
                insertedId: result.insertId,
                message: 'Workdiary entry created successfully'
            });

        } catch (error) {
            console.error('Database error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Request error:', error);
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