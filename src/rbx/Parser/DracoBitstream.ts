import { IS_DEV_MODE } from "@/core/env"
import { ByteReader } from "@/rbx/Parser/ByteReader"
import { assert } from "@/core/util"

/**
 * Any indexable numeric buffer. Draco writes into plain arrays and typed
 * arrays interchangeably, so the shared shape is what matters, not which.
 */
type NumArray = { [index: number]: number; length: number }

export interface DracoAttribute {
	attributeType: number
	dataType: number
	numComponents: number
	normalized: number
	uniqueId: number
	decoderType: number | null
	values?: ArrayLike<number>

	// Assigned while decoding, per prediction scheme. Declared because the index
	// signature below resolves to unknown, which is correct for anything we have
	// not modelled but wrong for the fields the decoder itself writes.
	output?: NumArray
	input?: NumArray
	predictionScheme?: number
	predictionTransformType?: number
	wrapMin?: number
	wrapMax?: number
	octaMaxQ?: number
	flipNormals?: NumArray
	isCreaseEdge?: NumArray
	texOrientations?: NumArray

	[key: string]: unknown
}

export interface DracoDecoder {
	attributes: DracoAttribute[] | null
	pointIds: number[] | null
	index: number
	[key: string]: unknown
}

export interface DracoHeader {
	majorVersion: number
	minorVersion: number
	encoderType: number
	encoderMethod: number
	flags: number
}

// Low level rANS state machine. Fields are assigned by _start/init_* before use.
export interface Rans {
	buffer: Uint8Array
	startIndex: number
	offset: number
	base: number
	state: number
	precision: number
	prob_zero: number
	probabilityTable: { prob: number; cum_prob: number }[]
	lookupTable: number[]
	decodeTables(stream: ByteReader, expected_cum_prob: number): void
	_start(buffer: Uint8Array, startIndex: number, offset: number, base: number, precision: number): void
	read_symbol(): number
	init_symbols(stream: ByteReader, bitLength: number): void
	read_bit(): number
	init_bits(stream: ByteReader): void
}

export interface DracoParser {
	header: DracoHeader
	rans: Rans
	decoders: DracoDecoder[]
	attributes: DracoAttribute[]
	faces: number[]
	numFaces: number
	numPoints: number
	connectivityMethod: number
	bits_value: number
	bits_length: number
}

const METADATA_FLAG_MASK = 32768

// encoderType
export const POINT_CLOUD = 0 // not supported
const TRIANGULAR_MESH = 1

// encoderMethod
const MESH_SEQUENTIAL_ENCODING = 0
const MESH_EDGEBREAKER_ENCODING = 1 // not supported

// connectivityMethod
const SEQUENTIAL_COMPRESSED_INDICES = 0 // not supported
const SEQUENTIAL_UNCOMPRESSED_INDICES = 1

// encoderType
const SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC = 0
export const SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER = 1
const SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION = 2
const SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS = 3

// predictionMethod
const PREDICTION_NONE = -2
const PREDICTION_DIFFERENCE = 0
const MESH_PREDICTION_PARALLELOGRAM = 1 // not supported (requires edgebreaker)
const MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM = 4 // not supported (requires edgebreaker)
const MESH_PREDICTION_TEX_COORDS_PORTABLE = 5 // not supported (requires edgebreaker)
const MESH_PREDICTION_GEOMETRIC_NORMAL = 6 // not supported (requires edgebreaker)

// predictionTransformType
export const PREDICTION_TRANSFORM_NONE = -1
export const PREDICTION_TRANSFORM_DELTA = 0
const PREDICTION_TRANSFORM_WRAP = 1
const PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED = 3

export const DRACO_DATA_TYPES = [
	null,
	"DT_INT8",
	"DT_UINT8",
	"DT_INT16",
	"DT_UINT16",
	"DT_INT32",
	"DT_UINT32",
	"DT_INT64",
	"DT_UINT64",
	"DT_FLOAT32",
	"DT_FLOAT64",
	"DT_BOOL",
]

const DRACO_DATA_TYPE_SIZES = [0, 1, 1, 2, 2, 4, 4, 8, 8, 4, 8, 1]

export const DRACO_ATTR_TYPES = ["POSITION", "NORMAL", "COLOR", "TEX_COORD", "GENERIC"]

export const DracoBitstream = {
	parse(stream: any): DracoParser {
		const parser = {} as DracoParser

		// DecodeHeader
		const { majorVersion, minorVersion, encoderType, encoderMethod, flags } = (parser.header =
			this.parseHeader(stream))

		if (IS_DEV_MODE) {
			console.log(
				`DRACO ${majorVersion}.${minorVersion} | encoderType: ${encoderType}, encoderMethod: ${encoderMethod}, flags: ${flags}`,
			)
		}

		if (encoderType !== TRIANGULAR_MESH) {
			throw "draco encoderType not implemented"
		}

		// DecodeMetadata
		if (flags & METADATA_FLAG_MASK) {
			throw "draco flags not implemented"
		}

		// DecodeConnectivityData
		this.decodeConnectivityData(stream, parser, encoderMethod)

		// DecodeAttributeData
		this.decodeAttributeData(stream, parser, encoderMethod)

		// GenerateSequence
		this.generateSequence(parser, encoderMethod)

		// DecodeAttributes
		this.decodeAttributes(stream, parser)

		//

		parser.attributes = parser.decoders.at(-1)?.attributes ?? []

		return parser
	},

	parseHeader(stream: ByteReader): DracoHeader {
		const string = stream.String(5)

		if (string !== "DRACO") {
			throw "invalid draco bitstream"
		}

		const majorVersion = stream.UInt8()
		const minorVersion = stream.UInt8()
		const encoderType = stream.UInt8()
		const encoderMethod = stream.UInt8()
		const flags = stream.UInt16LE()

		return {
			majorVersion: majorVersion,
			minorVersion: minorVersion,
			encoderType: encoderType,
			encoderMethod: encoderMethod,
			flags: flags,
		}
	},

	//

	decodeConnectivityData(stream: ByteReader, parser: DracoParser, encoderMethod: number) {
		// DecodeConnectivityData
		if (encoderMethod === MESH_SEQUENTIAL_ENCODING) {
			const numFaces = (parser.numFaces = this.LEB128(stream))
			const numPoints = (parser.numPoints = this.LEB128(stream))
			const connectivityMethod = (parser.connectivityMethod = stream.UInt8())

			const faces = (parser.faces = new Array(numFaces * 3))

			if (connectivityMethod === SEQUENTIAL_COMPRESSED_INDICES) {
				throw "draco compressed indices not implemented"
			} else if (connectivityMethod === SEQUENTIAL_UNCOMPRESSED_INDICES) {
				if (numPoints < 256) {
					for (let i = 0; i < numFaces; i++) {
						faces[i * 3 + 0] = stream.UInt8()
						faces[i * 3 + 1] = stream.UInt8()
						faces[i * 3 + 2] = stream.UInt8()
					}
				} else if (numPoints < 1 << 16) {
					for (let i = 0; i < numFaces; i++) {
						faces[i * 3 + 0] = stream.UInt16LE()
						faces[i * 3 + 1] = stream.UInt16LE()
						faces[i * 3 + 2] = stream.UInt16LE()
					}
				} else if (numPoints < 1 << 21) {
					for (let i = 0; i < numFaces; i++) {
						faces[i * 3 + 0] = this.LEB128(stream)
						faces[i * 3 + 1] = this.LEB128(stream)
						faces[i * 3 + 2] = this.LEB128(stream)
					}
				} else {
					for (let i = 0; i < numFaces; i++) {
						faces[i * 3 + 0] = stream.UInt32LE()
						faces[i * 3 + 1] = stream.UInt32LE()
						faces[i * 3 + 2] = stream.UInt32LE()
					}
				}
			}
		} else if (encoderMethod === MESH_EDGEBREAKER_ENCODING) {
			throw "draco edgebreaker not implemented"
		} else {
			throw "draco encoderMethod not implemented"
		}
	},

	decodeAttributeData(stream: ByteReader, parser: DracoParser, encoderMethod: number) {
		// DecodeAttributeData
		const numAttributeDecoders = stream.UInt8()
		const decoders: DracoDecoder[] = (parser.decoders = [])

		for (let i = 0; i < numAttributeDecoders; i++) {
			decoders[i] = {
				attributes: null as any,
				pointIds: null as any,
				index: i,
			}
		}

		if (encoderMethod === MESH_EDGEBREAKER_ENCODING) {
			for (const decoder of decoders) {
				decoder.dataId = stream.UInt8()
				decoder.decoderType = stream.UInt8()
				decoder.traversalMethod = stream.UInt8()
			}
		}

		for (const decoder of decoders) {
			const numAttributes = this.LEB128(stream)

			const attributes = (decoder.attributes = new Array(numAttributes))

			for (let j = 0; j < numAttributes; j++) {
				const attributeType = stream.UInt8()
				const dataType = stream.UInt8()
				const numComponents = stream.UInt8()
				const normalized = stream.UInt8()
				const uniqueId = this.LEB128(stream)

				attributes[j] = {
					attributeType: attributeType,
					dataType: dataType,
					numComponents: numComponents,
					normalized: normalized,
					uniqueId: uniqueId,
					decoderType: null,
				}
			}

			for (const attribute of attributes) {
				const decoderType = stream.UInt8()

				attribute.decoderType = decoderType
			}
		}
	},

	generateSequence(parser: DracoParser, encoderMethod: number) {
		// GenerateSequence
		if (encoderMethod === MESH_SEQUENTIAL_ENCODING) {
			for (const decoder of parser.decoders) {
				const pointIds = (decoder.pointIds = new Array(parser.numPoints))

				for (let i = 0; i < parser.numPoints; i++) {
					pointIds[i] = i
				}
			}
		} else if (encoderMethod === MESH_EDGEBREAKER_ENCODING) {
			throw "draco edgebreaker not implemented"
		}
	},

	decodeAttributes(stream: ByteReader, parser: DracoParser) {
		// initialize rans
		parser.rans = this.createRans()

		// initialize values for bits methods
		parser.bits_value = 0
		parser.bits_length = 0

		for (const decoder of parser.decoders) {
			// SequentialAttributeDecodersController::DecodePortableAttributes()

			for (const attribute of decoder.attributes ?? []) {
				const decoderType = attribute.decoderType

				// console.log(
				// 	DRACO_DATA_TYPES[attribute.dataType],
				// 	attribute,
				// 	"index:", stream.GetIndex()
				// )

				if (decoderType === SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC) {
					this.decodeAttribute_Generic(stream, parser, decoder, attribute)
				} else {
					this.decodeAttribute_Compressed(stream, parser, decoder, attribute, decoderType)
				}
			}

			// DecodeDataNeededByPortableTransforms()
			// TransformAttributesToOriginalFormat()

			for (const attribute of decoder.attributes ?? []) {
				const decoderType = attribute.decoderType

				if (decoderType === SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION) {
					this.decodeAndTransformAttribute_Quantized(stream, parser, decoder, attribute)
				} else if (decoderType === SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS) {
					this.decodeAndTransformAttribute_Normals(stream, parser, decoder, attribute)
				} else {
					this.transformAttribute_Generic(parser, decoder, attribute)
				}
			}
		}
	},

	decodeAttribute_Generic(
		stream: ByteReader,
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
	) {
		const pointIds = decoder.pointIds
		const numEntries = (pointIds ?? []).length

		const numComponents = attribute.numComponents
		const numValues = numEntries * numComponents

		const output: number[] = []

		switch (DRACO_DATA_TYPE_SIZES[attribute.dataType]) {
			case 1:
				for (let k = 0; k < numValues; k++) {
					output[k] = stream.UInt8()
				}
				break
			case 2:
				for (let k = 0; k < numValues; k++) {
					output[k] = stream.UInt16LE()
				}
				break
			case 4:
				for (let k = 0; k < numValues; k++) {
					output[k] = stream.UInt32LE()
				}
				break
			case 8:
				for (let k = 0; k < numValues; k++) {
					output[k] = Number(stream.UInt64LE())
				}
				break
		}

		attribute.output = output
	},

	decodeAttribute_Compressed(
		stream: ByteReader,
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
		decoderType: number | null,
	) {
		// SequentialIntegerAttributeDecoder::DecodeValues
		const predictionScheme = (attribute.predictionScheme = stream.UInt8())
		let predictionTransformType

		if (
			predictionScheme !== undefined &&
			predictionTransformType !== undefined &&
			predictionScheme !== PREDICTION_NONE
		) {
			predictionTransformType = attribute.predictionTransformType = stream.Int8()
		}

		// SequentialIntegerAttributeDecoder::DecodeIntegerValues
		const compressed = stream.UInt8()

		const numEntries = (decoder.pointIds ?? []).length
		let numComponents = attribute.numComponents

		if (
			decoderType === SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS &&
			predictionScheme === PREDICTION_DIFFERENCE
		) {
			numComponents = 2
		}

		const numValues = numEntries * numComponents
		const output = (attribute.output = new Array(numValues))

		if (compressed > 0) {
			this.decodeSymbols(stream, parser, numValues, numComponents, output)
		} else {
			const size = stream.UInt8()

			switch (size) {
				case 1:
					for (let k = 0; k < numValues; k++) {
						output[k] = stream.UInt8()
					}
					break
				case 2:
					for (let k = 0; k < numValues; k++) {
						output[k] = stream.UInt16LE()
					}
					break
				case 4:
					for (let k = 0; k < numValues; k++) {
						output[k] = stream.UInt32LE()
					}
					break
				case 8:
					for (let k = 0; k < numValues; k++) {
						output[k] = Number(stream.UInt64LE())
					}
					break
				default:
					throw "draco invalid uncompressed size"
			}
		}

		// Convert the values back to the original signed format.
		if (
			numValues > 0 &&
			predictionTransformType !== PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED
		) {
			for (let i = 0; i < output.length; i++) {
				let value = output[i]
				output[i] = value & 1 ? -(value >>> 1) - 1 : value >>> 1
			}
		}

		if (
			predictionScheme !== undefined &&
			predictionTransformType !== undefined &&
			predictionScheme !== PREDICTION_NONE
		) {
			this.decodePredictionData(
				stream,
				parser,
				decoder,
				attribute,
				numValues,
				numComponents,
				predictionScheme,
				predictionTransformType,
			)

			if (numValues > 0) {
				this.computeOriginalValues(
					parser,
					decoder,
					attribute,
					numValues,
					numComponents,
					predictionScheme,
					predictionTransformType,
					output,
				)
			}
		}
	},

	decodeSymbols(
		stream: ByteReader,
		parser: DracoParser,
		numValues: number,
		numComponents: number,
		output: number[],
	) {
		// symbol_decoding.cc - DecodeSymbols
		const TAGGED_SYMBOLS = 0
		const RAW_SYMBOLS = 1

		const scheme = stream.UInt8()

		if (scheme === TAGGED_SYMBOLS) {
			parser.rans.init_symbols(stream, 5)

			for (let i = 0; i < numValues; i += numComponents) {
				const numBits = parser.rans.read_symbol()

				for (let j = 0; j < numComponents; j++) {
					output[i + j] = this.readBits(stream, parser, numBits)
				}
			}

			this.flushBits(parser)
		} else if (scheme === RAW_SYMBOLS) {
			const maxBitLength = stream.UInt8()

			parser.rans.init_symbols(stream, maxBitLength)

			for (let i = 0; i < numValues; i++) {
				output[i] = parser.rans.read_symbol()
			}
		}
	},

	decodePredictionData(
		stream: ByteReader,
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
		numValues: number,
		numComponents: number,
		predictionScheme: number,
		predictionTransformType: number,
	) {
		// DecodePredictionData

		if (predictionScheme === MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM) {
			throw "draco edgebreaker not implemented"
			// const isCreaseEdge = attribute.isCreaseEdge = []

			// for(let i = 0; i < 4; i++) {
			// 	const numFlags = this.LEB128(stream)

			// 	if(numFlags > 0) {
			// 		parser.rans.init_bits(stream)

			// 		for(let j = 0; j < numFlags; j++) {
			// 			isCreaseEdge[i][j] = parser.rans.read_bit() > 0
			// 		}
			// 	}
			// }
		} else if (predictionScheme === MESH_PREDICTION_TEX_COORDS_PORTABLE) {
			throw "draco edgebreaker not implemented"
			// const numOrientations = stream.Int32LE()

			// const texOrientations = attribute.texOrientations = []

			// parser.rans.init_bits(stream)

			// let last_orientation = true
			// for(let i = 0; i < numOrientations; i++) {
			// 	if(!parser.rans.read_bit()) {
			// 		last_orientation = !last_orientation
			// 	}

			// 	texOrientations.push(last_orientation)
			// }
		}

		// DecodeTransformData

		if (predictionTransformType === PREDICTION_TRANSFORM_WRAP) {
			attribute.wrapMin = stream.Int32LE()
			attribute.wrapMax = stream.Int32LE()
		} else if (predictionTransformType === PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED) {
			attribute.octaMaxQ = stream.Int32LE()
			stream.Int32LE() // octaUnused
		}

		// DecodePredictionData

		if (predictionScheme === MESH_PREDICTION_GEOMETRIC_NORMAL) {
			throw "draco edgebreaker not implemented"
			// const flipNormals = attribute.flipNormals = []
			// const numEntries = numValues / numComponents // ew

			// parser.rans.init_bits(stream)

			// for(let i = 0; i < numEntries; i++) {
			// 	flipNormals.push(parser.rans.read_bit() > 0)
			// }
		}
	},

	computeOriginalValues(
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
		numValues: number,
		numComponents: number,
		predictionScheme: number,
		predictionTransformType: number,
		output: NumArray,
	) {
		// ComputeOriginalValues
		let computeOriginalValue

		if (predictionTransformType === PREDICTION_TRANSFORM_WRAP) {
			const wrapMax = attribute.wrapMax
			const wrapMin = attribute.wrapMin
			assert(wrapMax !== undefined && wrapMin !== undefined, "draco: missing wrap range")

			const maxDif = 1 + wrapMax - wrapMin

			computeOriginalValue = (
				predictedArray: NumArray,
				predictedIndex: number,
				corrArray: NumArray,
				corrIndex: number,
				outputArray: NumArray,
				outputIndex: number,
			) => {
				for (let i = 0; i < numComponents; i++) {
					let value =
						Math.max(wrapMin, Math.min(wrapMax, predictedArray[predictedIndex + i])) +
						corrArray[corrIndex + i]

					if (value > wrapMax) {
						value -= maxDif
					} else if (value < wrapMin) {
						value += maxDif
					}

					outputArray[outputIndex + i] = value
				}
			}
		} else if (predictionTransformType === PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED) {
			assert(attribute.octaMaxQ !== undefined, "draco: missing octahedral quantization")
			let maxQuantizedValue = (1 << attribute.octaMaxQ) - 1
			let maxValue = maxQuantizedValue - 1
			let centerValue = maxValue / 2

			const invertDiamond = (s: number, t: number) => {
				let sign_s, sign_t

				if (s >= 0 && t >= 0) {
					sign_s = 1
					sign_t = 1
				} else if (s <= 0 && t <= 0) {
					sign_s = -1
					sign_t = -1
				} else {
					sign_s = s > 0 ? 1 : -1
					sign_t = t > 0 ? 1 : -1
				}

				const corner_point_s = sign_s * centerValue
				const corner_point_t = sign_t * centerValue

				let us = t + t - corner_point_t
				let ut = s + s - corner_point_s

				if (sign_s * sign_t >= 0) {
					us = -us
					ut = -ut
				}

				return [(us + corner_point_s) / 2, (ut + corner_point_t) / 2]
			}

			const getRotationCount = (pred: number[]) => {
				const sign_x = pred[0]
				const sign_y = pred[1]

				let rotation_count = 0

				if (sign_x === 0) {
					if (sign_y === 0) {
						rotation_count = 0
					} else if (sign_y > 0) {
						rotation_count = 3
					} else {
						rotation_count = 1
					}
				} else if (sign_x > 0) {
					if (sign_y >= 0) {
						rotation_count = 2
					} else {
						rotation_count = 1
					}
				} else {
					if (sign_y <= 0) {
						rotation_count = 0
					} else {
						rotation_count = 3
					}
				}

				return rotation_count
			}

			const rotatePoint = (point: number[], rotationCount: number) => {
				switch (rotationCount) {
					case 1:
						return [point[1], -point[0]]
					case 2:
						return [-point[0], -point[1]]
					case 3:
						return [-point[1], point[0]]
					default:
						return point
				}
			}

			const addAsUnsigned = (a: number, b: number) => {
				return (a >= 0 ? a : 4294967296 + a) + (b >= 0 ? b : 4294967296 + b)
			}

			const modMax = (x: number) => {
				return x > centerValue ? x - maxQuantizedValue : x < -centerValue ? x + maxQuantizedValue : x
			}

			computeOriginalValue = (
				predictedArray: NumArray,
				predictedIndex: number,
				corrArray: NumArray,
				corrIndex: number,
				outputArray: NumArray,
				outputIndex: number,
			) => {
				let pred = [
					predictedArray[predictedIndex + 0] - centerValue,
					predictedArray[predictedIndex + 1] - centerValue,
				]

				const corr = [corrArray[corrIndex + 0], corrArray[corrIndex + 1]]

				const isInDiamond = Math.abs(pred[0]) + Math.abs(pred[1]) <= centerValue

				if (!isInDiamond) {
					pred = invertDiamond(pred[0], pred[1])
				}

				const isInBottomLeft = (pred[0] === 0 && pred[1] === 0) || (pred[0] < 0 && pred[1] <= 0)
				const rotationCount = getRotationCount(pred)

				if (!isInBottomLeft) {
					pred = rotatePoint(pred, rotationCount)
				}

				let orig = [modMax(addAsUnsigned(pred[0], corr[0])), modMax(addAsUnsigned(pred[1], corr[1]))]

				if (!isInBottomLeft) {
					orig = rotatePoint(orig, (4 - rotationCount) % 4)
				}

				if (!isInDiamond) {
					orig = invertDiamond(orig[0], orig[1])
				}

				outputArray[outputIndex + 0] = orig[0] + centerValue
				outputArray[outputIndex + 1] = orig[1] + centerValue
			}
		} else {
			computeOriginalValue = (
				predictedArray: NumArray,
				predictedIndex: number,
				corrArray: NumArray,
				corrIndex: number,
				outputArray: NumArray,
				outputIndex: number,
			) => {
				for (let i = 0; i < numComponents; i++) {
					outputArray[outputIndex + i] =
						predictedArray[predictedIndex + i] + corrArray[corrIndex + i]
				}
			}
		}

		if (predictionScheme === PREDICTION_DIFFERENCE) {
			const zeroValues = new Array(numComponents).fill(0)

			// Decode the original value for the first element.
			computeOriginalValue(zeroValues, 0, output, 0, output, 0)

			// Decode data from the front using D(i) = D(i) + D(i - 1).
			for (let i = numComponents; i < numValues; i += numComponents) {
				computeOriginalValue(output, i - numComponents, output, i, output, i)
			}
		} else if (predictionScheme === MESH_PREDICTION_PARALLELOGRAM) {
			throw "draco edgebreaker not implemented"
		} else if (predictionScheme === MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM) {
			throw "draco edgebreaker not implemented"
		} else if (predictionScheme === MESH_PREDICTION_TEX_COORDS_PORTABLE) {
			throw "draco edgebreaker not implemented"
		} else if (predictionScheme === MESH_PREDICTION_GEOMETRIC_NORMAL) {
			throw "draco edgebreaker not implemented"
		}
	},

	decodeAndTransformAttribute_Quantized(
		stream: ByteReader,
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
	) {
		// SequentialQuantizationAttributeDecoder::DecodeQuantizedDataInfo()
		// AttributeQuantizationTransform::DecodeParameters
		const numComponents = attribute.numComponents
		assert(decoder.pointIds, "draco: decoder has no point ids")
		const numValues = decoder.pointIds.length * numComponents

		const output = attribute.output
		assert(output, "draco: attribute has no output buffer")
		const minValues: number[] = []

		for (let i = 0; i < numComponents; i++) {
			minValues[i] = stream.FloatLE()
		}

		const range = stream.FloatLE()
		const quantizationBits = stream.UInt8()

		const maxQuantizedValue = (1 << quantizationBits) - 1
		const delta = range / maxQuantizedValue

		for (let i = 0; i < numValues; i += numComponents) {
			for (let j = 0; j < numComponents; j++) {
				output[i + j] = minValues[j] + output[i + j] * delta
			}
		}
	},

	decodeAndTransformAttribute_Normals(
		stream: ByteReader,
		parser: DracoParser,
		decoder: DracoDecoder,
		attribute: DracoAttribute,
	) {
		assert(decoder.pointIds, "draco: decoder has no point ids")
		const numValues = decoder.pointIds.length * 2
		const input = attribute.output
		assert(input, "draco: attribute has no output buffer")

		const output: number[] = (attribute.output = [])

		const quantizationBits = stream.UInt8()

		const maxValue = (1 << quantizationBits) - 2
		const dequantizationScale = 2 / maxValue

		for (let i = 0; i < numValues; i += 2) {
			const s = input[i]
			const t = input[i + 1]

			let y = s * dequantizationScale - 1
			let z = t * dequantizationScale - 1

			const x = 1 - Math.abs(y) - Math.abs(z)

			let x_offset = -x
			x_offset = x_offset < 0 ? 0 : x_offset

			y += y < 0 ? x_offset : -x_offset
			z += z < 0 ? x_offset : -x_offset

			const norm_squared = x * x + y * y + z * z

			if (norm_squared < 1e-6) {
				output.push(0, 0, 0)
			} else {
				const d = 1.0 / Math.sqrt(norm_squared)
				output.push(x * d, y * d, z * d)
			}
		}
	},

	transformAttribute_Generic(parser: DracoParser, decoder: DracoDecoder, attribute: DracoAttribute) {
		const output = attribute.output
		assert(output, "draco: attribute has no output buffer")

		if (attribute.dataType === 9) {
			// DT_FLOAT32
			for (let i = 0; i < output.length; i++) {
				ByteReader.Converter.setUint32(0, output[i], true)
				output[i] = ByteReader.Converter.getFloat32(0, true)
			}
		} else if (attribute.dataType === 10) {
			// DT_FLOAT64
			for (let i = 0; i < output.length; i++) {
				ByteReader.Converter.setBigUint64(0, BigInt(output[i]), true)
				output[i] = ByteReader.Converter.getFloat64(0, true)
			}
		} else if (attribute.dataType === 11) {
			// DT_BOOL
			for (let i = 0; i < output.length; i++) {
				output[i] = output[i] !== 0 ? 1 : 0
			}
		}
	},

	//

	LEB128(stream: ByteReader) {
		let result = 0
		let shift = 0
		let value

		do {
			value = stream.UInt8()
			result |= (value & 0x7f) << shift
			shift += 7
		} while (value & 0x80)

		return result
	},

	createRans(): Rans {
		return {
			buffer: new Uint8Array(0),
			startIndex: 0,
			offset: 0,
			base: 0,
			state: 0,
			precision: 0,
			prob_zero: 0,
			probabilityTable: [],
			lookupTable: [],

			decodeTables(stream, expected_cum_prob) {
				const numSymbols = DracoBitstream.LEB128(stream)

				const probabilityTable: { prob: number; cum_prob: number }[] = []
				const lookupTable: number[] = []

				let cum_prob = 0
				let act_prob = 0

				for (let i = 0; i < numSymbols; i++) {
					const data = stream.UInt8()
					const token = data & 3

					if (token === 3) {
						const offset = data >>> 2

						for (let j = 0; j < offset + 1; j++) {
							probabilityTable[i + j] = { prob: 0, cum_prob: cum_prob }
						}

						i += offset
					} else {
						let prob = data >>> 2

						for (let j = 0; j < token; j++) {
							const eb = stream.UInt8()
							prob |= eb << (8 * (j + 1) - 2)
						}

						probabilityTable[i] = { prob: prob, cum_prob: cum_prob }
						cum_prob += prob

						for (let j = act_prob; j < cum_prob; j++) {
							lookupTable[j] = i
						}

						act_prob = cum_prob
					}
				}

				if (cum_prob !== expected_cum_prob) {
					console.log(cum_prob, expected_cum_prob)
					throw "something went wrong in symbols :("
				}

				this.probabilityTable = probabilityTable
				this.lookupTable = lookupTable
			},

			_start(buffer, startIndex, offset, base, precision) {
				this.buffer = buffer
				this.startIndex = startIndex

				this.base = base
				this.precision = precision

				const x = this.buffer[this.startIndex + offset - 1] >>> 6
				if (x === 0) {
					this.offset = offset - 1
					this.state = this.buffer[this.startIndex + offset - 1] & 0x3f
				} else if (x === 1) {
					this.offset = offset - 2
					this.state =
						((this.buffer[this.startIndex + offset - 1] << 8) |
							this.buffer[this.startIndex + offset - 2]) &
						0x3fff
				} else if (x === 2) {
					this.offset = offset - 3
					this.state =
						((this.buffer[this.startIndex + offset - 1] << 16) |
							(this.buffer[this.startIndex + offset - 2] << 8) |
							this.buffer[this.startIndex + offset - 3]) &
						0x3fffff
				} else if (x === 3) {
					this.offset = offset - 4
					this.state =
						((this.buffer[this.startIndex + offset - 1] << 24) |
							(this.buffer[this.startIndex + offset - 2] << 16) |
							(this.buffer[this.startIndex + offset - 3] << 8) |
							this.buffer[this.startIndex + offset - 4]) &
						0x3fffffff
				}

				this.state += base
			},

			read_symbol() {
				while (this.state < this.base && this.offset > 0) {
					this.state = (this.state << 8) | this.buffer[this.startIndex + --this.offset]
				}

				let quo = Math.floor(this.state / this.precision)
				let rem = this.state % this.precision

				let symbol = this.lookupTable[rem]
				let { prob, cum_prob } = this.probabilityTable[symbol]

				this.state = quo * prob + rem - cum_prob
				return symbol
			},

			init_symbols(stream, bitLength) {
				let precisionBits = Math.floor((3 * bitLength) / 2)
				if (precisionBits > 20) precisionBits = 20
				if (precisionBits < 12) precisionBits = 12

				let precision = 1 << precisionBits
				let base = precision * 4

				this.decodeTables(stream, precision)

				const dataSize = DracoBitstream.LEB128(stream)

				this._start(stream, stream.GetIndex(), dataSize, base, precision)
				stream.Jump(dataSize)
			},

			read_bit() {
				if (this.state < this.base && this.offset > 0) {
					this.state = (this.state << 8) | this.buffer[this.startIndex + --this.offset]
				}

				let quot = Math.floor(this.state / this.precision)
				let rem = this.state % this.precision

				const p = this.precision - this.prob_zero
				let val = rem < p

				if (val) {
					this.state = quot * p + rem
				} else {
					this.state = this.state - quot * p - p
				}

				return val ? 1 : 0
			},

			init_bits(stream) {
				this.prob_zero = stream.UInt8()

				const dataSize = DracoBitstream.LEB128(stream)

				this._start(stream, stream.GetIndex(), dataSize, 4096, 256)
				stream.Jump(dataSize)
			},
		}
	},

	readBits(stream: ByteReader, parser: DracoParser, n: number) {
		while (parser.bits_length < n) {
			const byte = stream.UInt8()

			for (let i = 0; i < 8; i++) {
				parser.bits_value = (parser.bits_value << 1) | ((byte >>> i) & 1)
			}

			parser.bits_length += 8
		}

		let value = 0

		for (let bit = 0; bit < n; bit++) {
			parser.bits_length -= 1
			value |= ((parser.bits_value >>> parser.bits_length) & 1) << bit
		}

		return value
	},

	flushBits(parser: DracoParser) {
		parser.bits_value = 0
		parser.bits_length = 0
	},
}
