pip install pyinstaller
pip install -r requirements.txt
python -m PyInstaller --clean -y -n fbn -F format_branch_name.py
setx path "%path%;%cd%/dist"
