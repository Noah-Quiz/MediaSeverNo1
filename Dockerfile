# Sử dụng hình ảnh Node.js phiên bản 20 LTS
FROM node:20

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Sao chép tệp package.json và package-lock.json
COPY package*.json ./

# Cài đặt các gói phụ thuộc
RUN npm install

# Sao chép toàn bộ mã nguồn vào container
COPY . .


# Chạy ứng dụng
CMD ["npm", "start"]
