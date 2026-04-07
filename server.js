require('dotenv').config();
const express = require('express');
const path = require('path');
const { Resend } = require('resend');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const adapter = new PrismaBetterSqlite3(process.env.DATABASE_URL.replace('file:', ''));
const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/enroll', async (req, res) => {
  const { firstName, lastName, email, phone } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'First name, last name, and email are required.' });
  }

  try {
    await prisma.enrollment.create({
      data: { firstName, lastName, email, phone: phone || null },
    });

    await resend.emails.send({
      from: 'Aqua Teal <onboarding@resend.dev>',
      to: email,
      subject: 'Your Spot is Reserved - Construction Contract Administration Bootcamp',
      html: `
        <h2>Hi ${firstName},</h2>
        <p>Thank you for registering for the <strong>Construction Contract Administration Bootcamp</strong>.</p>
        <p>We have received your enrollment request and will be in touch shortly with next steps.</p>
        <br/>
        <p><strong>Your Details:</strong></p>
        <p>Name: ${firstName} ${lastName}</p>
        <p>Email: ${email}</p>
        ${phone ? `<p>Phone: ${phone}</p>` : ''}
        <br/>
        <p>See you in the bootcamp!</p>
        <p>The Aqua Teal Team</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Resend error:', err);
    res.status(500).json({ error: 'Failed to send confirmation email.' });
  }
});

app.listen(PORT, () => {
  console.log(`Aqua Teal server running at http://localhost:${PORT}`);
});
