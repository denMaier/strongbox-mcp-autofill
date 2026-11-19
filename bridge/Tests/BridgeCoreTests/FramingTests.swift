import Foundation
import XCTest
@testable import BridgeCore

final class FramingTests: XCTestCase {
    private func header(_ length: UInt32) -> Data {
        var length = length
        return Data(bytes: &length, count: 4)
    }

    private func input(_ data: Data) throws -> FileHandle {
        let pipe = Pipe()
        try pipe.fileHandleForWriting.write(contentsOf: data)
        try pipe.fileHandleForWriting.close()
        return pipe.fileHandleForReading
    }

    func testPartialFrames() throws {
        for data in [Data(header(1).prefix(3)), header(2) + Data([1])] {
            XCTAssertThrowsError(try Framing.read(from: input(data))) {
                XCTAssertEqual($0 as? Framing.ReadError, .partial)
            }
        }
    }

    func testOversizeFrame() throws {
        let data = header(UInt32(Framing.requestLimit + 1))
        XCTAssertThrowsError(try Framing.read(from: input(data))) {
            XCTAssertEqual($0 as? Framing.ReadError, .oversize)
        }
    }

    func testZeroLengthFrameAndEndOfInput() throws {
        let stream = try input(header(0) + header(1) + Data([42]))
        XCTAssertEqual(try Framing.read(from: stream), Data())
        XCTAssertEqual(try Framing.read(from: stream), Data([42]))
        XCTAssertNil(try Framing.read(from: stream))
    }

    func testWriteFrame() throws {
        let pipe = Pipe()
        let body = Data("{}".utf8)
        try Framing.write(body, to: pipe.fileHandleForWriting)
        try pipe.fileHandleForWriting.close()
        XCTAssertEqual(try pipe.fileHandleForReading.readToEnd(), header(2) + body)
    }
}
