'use strict'

const Patient = require('../models/patient.model')
const Device = require('../models/device.model')
const Ward = require('../models/ward.model')
const httpStatus = require('http-status')
const APIError = require('../utils/APIError')
const ObjectId = require('mongoose').Types.ObjectId
const { omit } = require('lodash')

exports.admit = async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.body.ward)) throw new APIError('Invalid ward', httpStatus.INTERNAL_SERVER_ERROR)
    if (!ObjectId.isValid(req.body.bed)) throw new APIError('Invalid bed', httpStatus.INTERNAL_SERVER_ERROR)

    const result = await Ward.findById(req.body.ward).where('beds._id').equals(req.body.bed).select('beds')
    if (!result) throw new APIError('Invalid bed', httpStatus.INTERNAL_SERVER_ERROR)
    const bed = result.beds.find(v => ObjectId(req.body.bed).equals(v._id))

    // we enforces only authorized devices are assigned to a bed, so its safe just to check whether bed has a device or not
    if (bed.patient !== null) throw new APIError('Bed already taken', httpStatus.INTERNAL_SERVER_ERROR)

    const record = req.body
    record.admittedBy = req.user._id

    // we need more validation logic, but i laeve it here

    const newRecord = new Patient(record)
    const saved = await newRecord.save()

    await Ward.findOneAndUpdate({
      '_id': req.body.ward,
      'beds._id': req.body.bed
    }, {
      '$set': {
        'beds.$.patient': saved._id
      }
    })

    if (bed.device !== null) {
      // if bed has a device just set the mqtt topics so they can connect on the fly
      const mqttTopic = `wards/${req.body.ward}/patient/${saved._id}`
      await Device.findByIdAndUpdate(bed.device, { mqttTopic: mqttTopic })
    }

    res.status(httpStatus.CREATED)
    return res.json({patient: saved})
  } catch (error) {
    return next(Patient.checkDuplicateBHTError(error))
  }
}

exports.discharge = async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.patient)) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    // a good place to summerize data in here; well lets do it later right ;)

    const patient = await Patient.findById(req.params.patient)

    if (!patient) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    if (patient.discharged === true) throw new APIError('Already discharged', httpStatus.INTERNAL_SERVER_ERROR)

    // mark as discharged
    patient.discharged = true
    patient.dischargedBy = req.user._id
    patient.dischargedAt = Date.now()

    const saved = await patient.save()

    // remove from bed
    const ward = await Ward.findOneAndUpdate({
      '_id': patient.ward,
      'beds._id': patient.bed
    }, {
      '$set': {
        'beds.$.patient': null
      }
    }, {
      new: true
    }).select('beds')

    if (!ward) throw new APIError('Requested ward not found', httpStatus.INTERNAL_SERVER_ERROR)

    // detach device
    const bed = ward.beds.find(v => ObjectId(patient.bed).equals(v._id))
    if (!bed) throw new APIError('Requested bed not found', httpStatus.INTERNAL_SERVER_ERROR)

    if (bed.device !== null) {
      const device = await Device.findByIdAndUpdate(bed.device, { mqttTopic: null })
      if (!device) throw new APIError('Requested device not found', httpStatus.INTERNAL_SERVER_ERROR)
    }

    return res.json({
      patient: saved
    })
  } catch (error) {
    return next(error)
  }
}

exports.delete = async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.patient)) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    // a good place to summerize data in here; well lets do it later right ;)

    // mark as discharged
    const patient = await Patient.findByIdAndRemove(req.params.patient)

    if (!patient) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    // remove from bed
    const ward = await Ward.findOneAndUpdate({
      '_id': patient.ward,
      'beds._id': patient.bed
    }, {
      '$set': {
        'beds.$.patient': null
      }
    }, {
      new: true
    }).select('beds')

    if (!ward) throw new APIError('Requested ward not found', httpStatus.INTERNAL_SERVER_ERROR)

    // detach device
    const bed = ward.beds.find(v => ObjectId(patient.bed).equals(v._id))
    if (!bed) throw new APIError('Requested bed not found', httpStatus.INTERNAL_SERVER_ERROR)

    if (bed.device !== null) {
      const device = await Device.findByIdAndUpdate(bed.device, { mqttTopic: null })
      if (!device) throw new APIError('Requested device not found', httpStatus.INTERNAL_SERVER_ERROR)
    }

    return res.json({
      patient
    })
  } catch (error) {
    return next(error)
  }
}

exports.view = async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.patient)) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    const patient = await Patient.findById(req.params.patient).select('-records')

    if (!patient) throw new APIError('Patient not found', httpStatus.NOT_FOUND)

    return res.json({patient})
  } catch (error) {
    return next(error)
  }
}

exports.update = async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.patient)) throw new APIError('Invalid patient', httpStatus.INTERNAL_SERVER_ERROR)

    const body = omit(req.body, [ 'bed', 'ward', 'records', 'admittedBy', 'admittedAt', 'dischargedAt', 'dischargedBy', 'discharged' ])
    const patient = await Patient.findByIdAndUpdate(req.params.patient, {body}, {new: true})

    if (!patient) throw new APIError('Patient not found', httpStatus.INTERNAL_SERVER_ERROR)

    return res.json({patient})
  } catch (error) {
    return next(Patient.checkDuplicateBHTError(error))
  }
}

exports.index = async (req, res, next) => {
  try {
    const result = await Patient.list(req.query)
    return res.json(result)
  } catch (error) {
    return next(error)
  }
}
