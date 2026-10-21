// ─── Certificate Controller (Multi-DB with Prisma) ───────────────────

exports.getCertificates = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { type, student_id } = req.query;
    
    const where = { college_id: req.collegeId };
    if (type) where.type = type;
    if (student_id) where.student_id = student_id;

    const certs = await tenantDb.certificate.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const formatted = certs.map(c => ({
      ...c,
      _id: c.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

exports.createCertificate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      student_id,
      type,
      issueDate,
      content,
      predictedPerformance,
      academicConsistency,
      basedOn,
      status
    } = req.body;

    const { generateVerifyToken } = require('../services/documentTemplates');
    const { recordVerifyToken } = require('../services/verifyToken.service');
    const certNum = `CERT-${type?.toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;
    const verifyToken = generateVerifyToken();

    const cert = await tenantDb.certificate.create({
      data: {
        college_id: req.collegeId,
        student_id,
        type,
        certificateNumber: certNum,
        issueDate: issueDate ? new Date(issueDate) : new Date(),
        content: content || null,
        predictedPerformance: predictedPerformance || null,
        academicConsistency: academicConsistency || null,
        basedOn: basedOn || null,
        issuedBy: req.user._id,
        status: status || 'issued',
        verifyToken
      }
    });

    await recordVerifyToken({
      token: verifyToken,
      collegeId: req.collegeId,
      kind: 'certificate',
      refId: cert.id
    }).catch(err => console.error('Failed to register verifyToken:', err.message));

    res.status(201).json({
      success: true,
      data: {
        ...cert,
        _id: cert.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getCertificate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const cert = await tenantDb.certificate.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });

    if (!cert) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    res.json({
      success: true,
      data: {
        ...cert,
        _id: cert.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.revokeCertificate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;

    // Check if certificate exists first
    const certExists = await tenantDb.certificate.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });

    if (!certExists) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    const cert = await tenantDb.certificate.update({
      where: { id: req.params.id },
      data: { status: 'revoked' }
    });

    res.json({
      success: true,
      data: {
        ...cert,
        _id: cert.id
      }
    });
  } catch (error) {
    next(error);
  }
};

