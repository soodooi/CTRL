#!/usr/bin/env swift
import Foundation
import Security

// Secret values enter through stdin, never process arguments.
// (ADR-004 cap § updater v8)

enum KeychainError: Error {
    case usage
    case emptySecret
    case osStatus(OSStatus)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("error: \(message)\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 4, CommandLine.arguments[1] == "add" else {
    fail("usage: keychain-secret.swift add <service> <account>")
}
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let secret = FileHandle.standardInput.readDataToEndOfFile()
guard !secret.isEmpty else {
    fail("refusing to store an empty Keychain secret")
}

let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: service,
    kSecAttrAccount: account,
]
var item = query
item[kSecValueData] = secret
item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlock
let addStatus = SecItemAdd(item as CFDictionary, nil)
if addStatus != errSecSuccess {
    fail("could not add Keychain item (OSStatus \(addStatus))")
}
