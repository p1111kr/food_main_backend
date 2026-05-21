const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'peterkoru94@gmail.com', // Your Gmail
        pass: 'rgzpvhiuhxgbolse'   // Your 16-character App Password
    }
});

module.exports = transporter;