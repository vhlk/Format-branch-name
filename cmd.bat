Set FilePath=%cd%/format_branch_name.py
reg add "HKCU\Software\Microsoft\Command Processor" /v Autorun /d "doskey fbn=python %FilePath%" /f