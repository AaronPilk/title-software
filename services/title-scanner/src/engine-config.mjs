import { isAbsolute } from 'node:path';

/** Generate the required scanner policy into a private instance directory; never edit global ClamAV config. */
export function engineConfiguration({ databaseDirectory, socketPath, temporaryDirectory }) {
  for (const path of [databaseDirectory, socketPath, temporaryDirectory]) {
    if (typeof path !== 'string' || !isAbsolute(path) || /[\r\n\0]/.test(path)) throw new Error('invalid_engine_path');
  }
  return `Foreground yes
DatabaseDirectory ${databaseDirectory}
LocalSocket ${socketPath}
LocalSocketMode 600
FixStaleSocket yes
TemporaryDirectory ${temporaryDirectory}
OfficialDatabaseOnly yes
BytecodeUnsigned no
LogClean no
LogVerbose no
LogSyslog no
ExtendedDetectionInfo no
Debug no
MaxThreads 2
MaxQueue 4
MaxConnectionQueueLength 4
CommandReadTimeout 5
ReadTimeout 10
SendBufTimeout 500
StreamMaxLength 50M
MaxScanTime 15000
MaxScanSize 200M
MaxFileSize 50M
MaxRecursion 16
MaxFiles 10000
PCREMaxFileSize 50M
HeuristicAlerts yes
AlertExceedsMax yes
AlertEncrypted yes
AlertEncryptedArchive yes
AlertEncryptedDoc yes
AlertBrokenExecutables yes
AlertBrokenMedia yes
ScanArchive yes
ScanPDF yes
ScanOLE2 yes
ScanXMLDOCS yes
ScanPE yes
ScanELF yes
ScanMail yes
SelfCheck 600
`;
}
