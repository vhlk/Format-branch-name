# Format-branch-name (FBN)
Formating branch names to be compatible with our Gitlab standard

# Installing
Just do
```
pip install -r requirements.txt
```
PS: You may need to use "pip3" instead of "pip".


### Linux prerequisite
For copy/paste it's also needed to use xclip. Install with:
```
sudo apt install xclip
```

# Adding the script as a command
## Linux
There is two ways: creating a symbolic link or adding this directory to the path. Creating a symlink is easier and we can customize the command name, so that is the option selected:
```
sudo ln -s `pwd`/format_branch_name.py /usr/local/bin/fbn
```

# Running
Just do
```
fbn
```
anywhere in a terminal.

<br><br>

If you could not add the command, you could also run the file normally:
```
python format_branch_name.py
```
PS: You may need to use "python3" instead of "python"