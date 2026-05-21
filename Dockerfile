# Step 1: Use the official Node.js base image
# (you can also use Ubuntu base image and install Node.js manually if needed)
FROM node:20-alpine

# Step 2: Install FFmpeg
RUN apk update && apk add ffmpeg

# Step 3: Set the working directory inside the container
WORKDIR /video_transcoder

# Step 4: Copy the package.json and package-lock.json files first (for caching)
COPY package.json .

# Step 5: Install Node.js dependencies
RUN npm install

# Step 6: Copy the rest of the application code

COPY . ./


# Step 7: Expose the port the app will run on (adjust if needed)
EXPOSE 3000

# Step 8: Start the Node.js application
CMD [ "npm", "start" ]