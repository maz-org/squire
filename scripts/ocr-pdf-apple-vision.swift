import AppKit
import Foundation
import PDFKit
import Vision

struct Arguments {
  let inputPath: String
  let outputPath: String
  let sourceURL: String
  let capturedDate: String
}

func usage() -> Never {
  fputs(
    """
    Usage:
      swift scripts/ocr-pdf-apple-vision.swift <input.pdf> <output.md> [source-url] [captured-date]

    Notes:
      - macOS only: uses PDFKit and Vision.
      - Output is a baseline OCR snapshot, not a final vendor-quality extraction.

    """,
    stderr
  )
  exit(2)
}

func parseArguments() -> Arguments {
  let args = CommandLine.arguments
  guard args.count >= 3 else { usage() }

  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withFullDate]

  return Arguments(
    inputPath: args[1],
    outputPath: args[2],
    sourceURL: args.count >= 4 ? args[3] : "",
    capturedDate: args.count >= 5 ? args[4] : formatter.string(from: Date())
  )
}

func render(page: PDFPage, scale: CGFloat) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  let width = Int(box.width * scale)
  let height = Int(box.height * scale)
  let colorSpace = CGColorSpaceCreateDeviceRGB()

  guard
    let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    return nil
  }

  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  return context.makeImage()
}

func recognizedLines(from image: CGImage) throws -> [String] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-US"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  return (request.results ?? [])
    .compactMap { observation -> (CGRect, String)? in
      guard
        let text = observation.topCandidates(1).first?.string.trimmingCharacters(
          in: .whitespacesAndNewlines
        ),
        !text.isEmpty
      else {
        return nil
      }

      return (observation.boundingBox, text)
    }
    .sorted { left, right in
      if abs(left.0.midY - right.0.midY) > 0.012 {
        return left.0.midY > right.0.midY
      }
      return left.0.minX < right.0.minX
    }
    .map(\.1)
}

let arguments = parseArguments()
let inputURL = URL(fileURLWithPath: arguments.inputPath)

guard let document = PDFDocument(url: inputURL) else {
  fputs("Could not open PDF: \(arguments.inputPath)\n", stderr)
  exit(1)
}

var pageMarkdown: [String] = []

for index in 0..<document.pageCount {
  guard let page = document.page(at: index), let image = render(page: page, scale: 3.0) else {
    continue
  }

  let lines = try recognizedLines(from: image)
  pageMarkdown.append("\n\n## Page \(index + 1)\n\n" + lines.joined(separator: "\n"))
  print("page \(index + 1)/\(document.pageCount): \(lines.count) lines")
  fflush(stdout)
}

let header =
  """
  # Gloomhaven: Second Edition Rulebook OCR Text Snapshot

  Source PDF: \(arguments.inputPath)
  Official source URL: \(arguments.sourceURL)
  Captured: \(arguments.capturedDate)

  This normalized text snapshot was generated from the official image-based PDF with macOS Vision OCR so Squire can index the rulebook for retrieval and citation. Refresh it whenever the source PDF is replaced.
  """

try (header + pageMarkdown.joined(separator: "\n")).write(
  toFile: arguments.outputPath,
  atomically: true,
  encoding: .utf8
)
