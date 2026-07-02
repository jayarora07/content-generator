#!/bin/bash
# Personal Brand OS launcher — double-click this file to start the app.
cd "$(dirname "$0")"

export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

if [ ! -d node_modules ]; then
  echo "First run — installing (takes a minute)..."
  npm install
fi

( sleep 2 && open "http://localhost:3999" ) &
npm start
